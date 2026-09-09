import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { CargoService } from '../cargo/cargo.service';
import type { CargoResponseDto } from '../cargo/cargo.dto';
import { CargoStatus } from '../cargo/entities/cargo.entity';
import { TaskStatus } from '../cargo/entities/transport-task.entity';
import { TRANSPORT_TASK_EVENTS } from '../cargo/domain/events';
import type { CargoDto, CreateCargoBody, OperatingCargoStatus } from './dto/operating.dto';

const LIST_LIMIT = 200;

/**
 * Maps wes cargo (CargoResponseDto — the full state-machine view) to the flat `Cargo` shape the
 * operating client expects, and pushes a bare SSE tick whenever a transport task changes so the
 * client re-fetches. All cargo lifecycle stays in CargoService.
 */
@Injectable()
export class OperatingCargoService {
  private readonly ticks = new Subject<void>();

  constructor(private readonly cargo: CargoService) {}

  get changes$(): Observable<void> {
    return this.ticks.asObservable();
  }

  @OnEvent([
    TRANSPORT_TASK_EVENTS.CREATED,
    TRANSPORT_TASK_EVENTS.STATUS_CHANGED,
    TRANSPORT_TASK_EVENTS.COMPLETED,
    TRANSPORT_TASK_EVENTS.FAILED,
  ])
  onTaskChanged(): void {
    this.ticks.next();
  }

  async list(): Promise<CargoDto[]> {
    const { cargos } = await this.cargo.list({ page: 1, limit: LIST_LIMIT });
    return cargos
      .filter((cargo) => cargo.status !== CargoStatus.CANCELLED && !cargo.deletedAt)
      .map((cargo) => toCargoDto(cargo));
  }

  async create(body: CreateCargoBody, userId: string): Promise<CargoDto> {
    const created = await this.cargo.create(
      {
        itemCode: body.cargoId,
        sourcePointName: body.pickupPointName,
        destinationZoneId: body.targetStoreAreaWesId,
      },
      userId,
    );
    return toCargoDto(await this.cargo.findOne(created.id));
  }

  async cancel(id: string): Promise<CargoDto> {
    const before = await this.cargo.findOne(id);
    await this.cargo.remove(id);
    return { ...toCargoDto(before), status: 'FAILED', doneAt: new Date().toISOString() };
  }
}

function mapStatus(cargo: CargoResponseDto): OperatingCargoStatus {
  if (
    cargo.status === CargoStatus.DELIVERED ||
    cargo.taskStatus === TaskStatus.DELIVERY_COMPLETED
  ) {
    return 'DONE';
  }
  switch (cargo.taskStatus) {
    case null:
    case TaskStatus.CREATED:
    case TaskStatus.READY_TO_ASSIGN:
      return 'QUEUED';
    case TaskStatus.BLOCKED:
      return 'BLOCKED';
    case TaskStatus.PICKING_UP:
      return cargo.assignedVehicleName ? 'PICKING' : 'PICK_PENDING';
    case TaskStatus.DELIVERING:
      return cargo.visual.state === 'AT_DESTINATION' ? 'SHIPPING' : 'CARRYING';
    case TaskStatus.FAILED:
      return 'FAILED';
    default:
      return 'QUEUED';
  }
}

function toCargoDto(cargo: CargoResponseDto): CargoDto {
  const done =
    cargo.status === CargoStatus.DELIVERED ||
    cargo.taskStatus === TaskStatus.DELIVERY_COMPLETED;
  return {
    cargoId: cargo.id,
    status: mapStatus(cargo),
    processingVehicle: cargo.assignedVehicleName,
    pickupAreaWesId: cargo.sourceZoneId,
    pickupPointName: cargo.sourcePointName,
    pickupLocationName: cargo.sourcePickupLocationName,
    targetStoreAreaWesId: cargo.destinationZoneId,
    dropPointName: cargo.visual.state === 'AT_DESTINATION' ? cargo.visual.pointName : null,
    dropLocationName: cargo.destinationLocationName,
    failureReason: cargo.blockedReason,
    createdAt: cargo.createdAt.toISOString(),
    updatedAt: cargo.updatedAt.toISOString(),
    doneAt: done ? cargo.updatedAt.toISOString() : null,
  };
}
