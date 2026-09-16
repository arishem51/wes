import { ForbiddenException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { CargoService } from '../../cargo/cargo.service';
import type { CargoResponseDto } from '../../cargo/cargo.dto';
import { CargoStatus } from '../../cargo/entities/cargo.entity';
import { TaskStatus } from '../../cargo/entities/transport-task.entity';
import { TRANSPORT_TASK_EVENTS } from '../../cargo/domain/events';
import { ActiveMapRecordService } from '../../maps/infrastructure/active-map-record.service';
import type {
  CargoDto,
  CargoListDto,
  CreateCargoBody,
  OperatingCargoStatus,
} from '../dto/operating.dto';

const LIST_LIMIT = 200;

/**
 * Maps wes cargo (CargoResponseDto — the full state-machine view) to the flat `Cargo` shape the
 * operating client expects, and pushes a bare SSE tick whenever a transport task changes so the
 * client re-fetches. All cargo lifecycle stays in CargoService.
 */
@Injectable()
export class OperatingCargoService {
  private readonly ticks = new Subject<void>();

  constructor(
    private readonly cargo: CargoService,
    private readonly activeMapRecords: ActiveMapRecordService,
  ) {}

  get changes$(): Observable<void> {
    return this.ticks.asObservable();
  }

  @OnEvent(TRANSPORT_TASK_EVENTS.CREATED)
  @OnEvent(TRANSPORT_TASK_EVENTS.STATUS_CHANGED)
  @OnEvent(TRANSPORT_TASK_EVENTS.COMPLETED)
  @OnEvent(TRANSPORT_TASK_EVENTS.FAILED)
  @OnEvent(TRANSPORT_TASK_EVENTS.UPDATED)
  onTaskChanged(): void {
    this.ticks.next();
  }

  /** `mapIds`: the caller's AUTH-3 map scope (`undefined` = unrestricted — see `ability.ts`). */
  async list(mapIds?: string[]): Promise<CargoListDto> {
    if (!(await this.mapInScope(mapIds)))
      return { cargos: [], total: 0, truncated: false };

    const { cargos, total, truncated } = await this.cargo.list({
      page: 1,
      limit: LIST_LIMIT,
      activeMapOnly: true,
    });
    return {
      cargos: cargos
        .filter(
          (cargo) => cargo.status !== CargoStatus.CANCELLED && !cargo.deletedAt,
        )
        .map((cargo) => toCargoDto(cargo)),
      total,
      truncated,
    };
  }

  /** True unless the caller is scoped and the currently-loaded map falls outside that scope —
   *  same check as `OperatingAreasService.mapInScope`; cargo mutations always act against
   *  whatever map the kernel currently has loaded, the same way an Area edit does. */
  private async mapInScope(mapIds: string[] | undefined): Promise<boolean> {
    if (mapIds === undefined) return true;
    const activeId = await this.activeMapRecords.resolveId();
    return activeId !== null && mapIds.includes(activeId);
  }

  private async assertMapInScope(mapIds: string[] | undefined): Promise<void> {
    if (!(await this.mapInScope(mapIds))) {
      throw new ForbiddenException(
        'Vai trò của bạn không được gán quyền thao tác trên bản đồ đang tải.',
      );
    }
  }

  async create(
    body: CreateCargoBody,
    userId: string,
    mapIds?: string[],
  ): Promise<CargoDto> {
    await this.assertMapInScope(mapIds);
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

  async cancel(id: string, mapIds?: string[]): Promise<CargoDto> {
    await this.assertMapInScope(mapIds);
    const before = await this.cargo.findOne(id);
    await this.cargo.remove(id);
    return {
      ...toCargoDto(before),
      status: 'FAILED',
      doneAt: new Date().toISOString(),
    };
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
    itemCode: cargo.itemCode,
    status: mapStatus(cargo),
    processingVehicle: cargo.assignedVehicleName,
    pickupAreaWesId: cargo.sourceZoneId,
    pickupPointName: cargo.sourcePointName,
    pickupLocationName: cargo.sourcePickupLocationName,
    targetStoreAreaWesId: cargo.destinationZoneId,
    dropPointName:
      cargo.visual.state === 'AT_DESTINATION' ? cargo.visual.pointName : null,
    dropLocationName: cargo.destinationLocationName,
    failureReason: cargo.blockedReason,
    createdAt: cargo.createdAt.toISOString(),
    updatedAt: cargo.updatedAt.toISOString(),
    doneAt: done ? cargo.updatedAt.toISOString() : null,
  };
}
