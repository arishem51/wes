import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import type {
  CargoResponseDto,
  CargoVisualDto,
  CreateCargoDto,
  ListCargosQueryDto,
} from './cargo.dto';

@Injectable()
export class CargoService {
  constructor(
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly dispatchScheduler: DispatchSchedulerService,
  ) {}

  async create(dto: CreateCargoDto, userId: string): Promise<CargoEntity> {
    const pickupLocationName = await this.kernelApi.findPickupLocationForPoint(
      dto.sourcePointName,
    );
    if (!pickupLocationName) {
      throw new BadRequestException(
        `Point "${dto.sourcePointName}" is invalid or is not linked to a PICKUP location.`,
      );
    }

    const occupiedSource = await this.cargoRepo.findOne({
      where: {
        sourcePointName: dto.sourcePointName,
        status: CargoStatus.ACTIVE,
      },
    });
    if (occupiedSource) {
      throw new BadRequestException(
        `Point "${dto.sourcePointName}" already has cargo waiting for transport (${occupiedSource.itemCode}).`,
      );
    }

    const deliveredAtDestination = await this.cargoRepo.findOne({
      where: {
        destinationLocationName: dto.destinationLocationName,
        status: CargoStatus.DELIVERED,
      },
    });
    if (deliveredAtDestination) {
      throw new BadRequestException('Đã có hàng đặt ở đây');
    }

    const cargo = this.cargoRepo.create({
      itemCode: dto.itemCode,
      sourcePointName: dto.sourcePointName,
      sourcePickupLocationName: pickupLocationName,
      destinationLocationName: dto.destinationLocationName,
      status: CargoStatus.ACTIVE,
      createdBy: userId,
    });
    const saved = await this.cargoRepo.save(cargo);

    const requestCode = `TR-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const task = this.taskRepo.create({
      requestCode,
      cargoId: saved.id,
      status: TaskStatus.CREATED,
      metadata: {},
    });
    await this.taskRepo.save(task);
    this.dispatchScheduler.schedule();

    return saved;
  }

  async list(query: ListCargosQueryDto = {}): Promise<CargoResponseDto[]> {
    const where = query.status ? { status: query.status as CargoStatus } : {};
    const cargos = await this.cargoRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return this.enrichCargos(cargos);
  }

  async findOne(id: string): Promise<CargoResponseDto> {
    const cargo = await this.cargoRepo.findOne({ where: { id } });
    if (!cargo) {
      throw new NotFoundException('Cargo not found.');
    }

    const [mapped] = await this.enrichCargos([cargo]);
    return mapped;
  }

  async remove(id: string): Promise<{ message: string }> {
    const cargo = await this.cargoRepo.findOne({ where: { id } });
    if (!cargo) {
      throw new NotFoundException('Cargo not found.');
    }

    const task = await this.taskRepo.findOne({ where: { cargoId: id } });
    if (task) {
      if (task.status === TaskStatus.PICKUP_COMPLETED) {
        throw new BadRequestException(
          'Khong the xoa - AGV da lay hang va dang tren duong tra.',
        );
      }

      if (task.status !== TaskStatus.DELIVERY_COMPLETED) {
        task.status = TaskStatus.CANCELLED;
        task.cancelledAt = new Date();
        await this.taskRepo.save(task);
      }
    }

    await this.cargoRepo.softDelete(id);
    return { message: 'Cargo da duoc xoa mem.' };
  }

  async getTaskByCargo(cargoId: string): Promise<TransportTaskEntity | null> {
    return this.taskRepo.findOne({ where: { cargoId } });
  }

  private async enrichCargos(
    cargos: CargoEntity[],
  ): Promise<CargoResponseDto[]> {
    if (cargos.length === 0) return [];

    const destinationPointEntries = await Promise.all(
      cargos.map(
        async (cargo) =>
          [
            cargo.id,
            cargo.destinationLocationName
              ? await this.kernelApi.findPointForLocation(
                  cargo.destinationLocationName,
                )
              : null,
          ] as const,
      ),
    );
    const destinationPointByCargoId = new Map(destinationPointEntries);

    const tasks = await this.taskRepo.find({
      where: { cargoId: In(cargos.map((cargo) => cargo.id)) },
      order: { createdAt: 'DESC' },
    });

    const taskByCargoId = new Map<string, TransportTaskEntity>();
    for (const task of tasks) {
      if (task.cargoId && !taskByCargoId.has(task.cargoId)) {
        taskByCargoId.set(task.cargoId, task);
      }
    }

    return cargos.map((cargo) => {
      const task = taskByCargoId.get(cargo.id) ?? null;
      return {
        id: cargo.id,
        itemCode: cargo.itemCode,
        sourcePointName: cargo.sourcePointName,
        sourcePickupLocationName: cargo.sourcePickupLocationName,
        destinationLocationName: cargo.destinationLocationName,
        status: cargo.status,
        createdBy: cargo.createdBy,
        createdAt: cargo.createdAt,
        updatedAt: cargo.updatedAt,
        deletedAt: cargo.deletedAt,
        taskStatus: task?.status ?? null,
        assignedVehicleName: task?.metadata.assignedVehicleName ?? null,
        visual: this.resolveVisual(
          cargo,
          task,
          destinationPointByCargoId.get(cargo.id) ?? null,
        ),
      };
    });
  }

  private resolveVisual(
    cargo: CargoEntity,
    task: TransportTaskEntity | null,
    destinationPointName: string | null,
  ): CargoVisualDto {
    if (task?.status === TaskStatus.PICKUP_COMPLETED) {
      return {
        state: 'ON_AGV',
        pointName: null,
        vehicleName: task.metadata.assignedVehicleName ?? null,
      };
    }

    if (
      task?.status === TaskStatus.DELIVERY_COMPLETED ||
      cargo.status === CargoStatus.DELIVERED
    ) {
      return {
        state: 'AT_DESTINATION',
        pointName: destinationPointName ?? cargo.destinationLocationName,
        vehicleName: null,
      };
    }

    return {
      state: 'AT_SOURCE',
      pointName: cargo.sourcePointName,
      vehicleName: null,
    };
  }
}
