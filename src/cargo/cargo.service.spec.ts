import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { CargoService } from './cargo.service';
import { CargoEntity } from './entities/cargo.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { ZoneEntity, ZoneType } from '../zones/entities/zone.entity';
import type { ZoneMemberEntity } from '../zones/entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { LaneSafetyService } from './lane-safety.service';
import type { CreateCargoDto } from './cargo.dto';

const DROPOFF_ZONE_ID = 'zone-dropoff';
const PICKUP_ZONE_ID = 'zone-pickup';
const DTO: CreateCargoDto = {
  sourcePointName: 'P-B',
  destinationZoneId: DROPOFF_ZONE_ID,
};

const dropoffZone = (capacity: number): ZoneEntity =>
  ({
    id: DROPOFF_ZONE_ID,
    name: 'Dropoff',
    type: ZoneType.DROPOFF,
    members: Array.from(
      { length: capacity },
      (_, index) =>
        ({
          locationName: `drop-${index}`,
          positionIndex: index,
        }) as ZoneMemberEntity,
    ),
  }) as ZoneEntity;

interface SetupOptions {
  capacity?: number;
  occupied?: number;
  pickupZoneId?: string | null;
}

function setup(options: SetupOptions = {}) {
  const capacity = options.capacity ?? 5;
  const occupied = options.occupied ?? 0;

  const cargoRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(occupied),
  };
  const taskRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const zoneRepo = {
    findOne: jest.fn().mockResolvedValue(dropoffZone(capacity)),
    createQueryBuilder: jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest
        .fn()
        .mockResolvedValue(
          options.pickupZoneId === null
            ? null
            : ({ id: options.pickupZoneId ?? PICKUP_ZONE_ID } as ZoneEntity),
        ),
    }),
  };

  const insertedCargos: CargoEntity[] = [];
  const transactionCargoRepo = {
    count: jest.fn().mockResolvedValue(occupied),
    create: jest.fn().mockImplementation((data: Partial<CargoEntity>) => data),
    save: jest.fn().mockImplementation((data: CargoEntity) => {
      const saved = { ...data, id: `cargo-${insertedCargos.length + 1}` };
      insertedCargos.push(saved);
      return Promise.resolve(saved);
    }),
  };
  const transactionTaskRepo = {
    create: jest
      .fn()
      .mockImplementation((data: Partial<TransportTaskEntity>) => data),
    save: jest
      .fn()
      .mockImplementation((data: TransportTaskEntity) =>
        Promise.resolve({ ...data, id: 'task-1' }),
      ),
  };
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest
      .fn()
      .mockImplementation((entity: unknown) =>
        entity === CargoEntity ? transactionCargoRepo : transactionTaskRepo,
      ),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation((work: (m: EntityManager) => Promise<unknown>) =>
        work(manager),
      ),
  };

  const kernelApi = {
    findPickupLocationForPoint: jest.fn().mockResolvedValue('loc-B'),
  };
  const transportTask = { publishCreated: jest.fn() };
  const laneSafety = {
    clearLaneForNewCargo: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new CargoService(
    cargoRepo as unknown as Repository<CargoEntity>,
    taskRepo as unknown as Repository<TransportTaskEntity>,
    zoneRepo as unknown as Repository<ZoneEntity>,
    dataSource as unknown as DataSource,
    kernelApi as unknown as KernelApiService,
    transportTask as unknown as TransportTaskService,
    laneSafety as unknown as LaneSafetyService,
  );

  return {
    svc,
    laneSafety,
    dataSource,
    insertedCargos,
    transactionCargoRepo,
    transportTask,
  };
}

describe('CargoService.create', () => {
  it('skips the lane guard when the source point is outside any pickup zone', async () => {
    const { svc, laneSafety, insertedCargos } = setup({ pickupZoneId: null });

    await svc.create(DTO, 'user-1');

    expect(laneSafety.clearLaneForNewCargo).not.toHaveBeenCalled();
    expect(insertedCargos).toHaveLength(1);
    expect(insertedCargos[0].sourceZoneId).toBeNull();
  });

  it('runs the lane guard for a source point inside a pickup zone', async () => {
    const { svc, laneSafety, insertedCargos } = setup();

    await svc.create(DTO, 'user-1');

    expect(laneSafety.clearLaneForNewCargo).toHaveBeenCalledWith(
      PICKUP_ZONE_ID,
      'loc-B',
    );
    expect(insertedCargos).toHaveLength(1);
  });

  it('rejects a full drop-off zone before touching any vehicle', async () => {
    const { svc, laneSafety, dataSource, insertedCargos } = setup({
      capacity: 2,
      occupied: 2,
    });

    await expect(svc.create(DTO, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(laneSafety.clearLaneForNewCargo).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(insertedCargos).toHaveLength(0);
  });

  it('creates nothing when the lane guard refuses the placement', async () => {
    const { svc, laneSafety, dataSource, insertedCargos, transportTask } =
      setup();
    laneSafety.clearLaneForNewCargo.mockRejectedValue(
      new BadRequestException('xe V1 đã được lệnh vào dãy này'),
    );

    await expect(svc.create(DTO, 'user-1')).rejects.toThrow(/V1/);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(insertedCargos).toHaveLength(0);
    expect(transportTask.publishCreated).not.toHaveBeenCalled();
  });

  it('creates nothing when withdrawing the preempted order fails', async () => {
    const { svc, laneSafety, dataSource, insertedCargos } = setup();
    laneSafety.clearLaneForNewCargo.mockRejectedValue(new Error('kernel down'));

    await expect(svc.create(DTO, 'user-1')).rejects.toThrow('kernel down');

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(insertedCargos).toHaveLength(0);
  });

  it('re-checks capacity under the advisory lock after preempting', async () => {
    const { svc, laneSafety, transactionCargoRepo, insertedCargos } = setup();
    transactionCargoRepo.count.mockResolvedValue(5);

    await expect(svc.create(DTO, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(laneSafety.clearLaneForNewCargo).toHaveBeenCalledTimes(1);
    expect(insertedCargos).toHaveLength(0);
  });
});
