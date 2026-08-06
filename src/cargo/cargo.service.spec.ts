import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { CargoService } from './cargo.service';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TaskStatus,
  TransportTaskEntity,
} from './entities/transport-task.entity';
import { TaskStatusTransitionEntity } from './entities/task-status-transition.entity';
import { ZoneEntity, ZoneType } from '../zones/entities/zone.entity';
import type { ZoneMemberEntity } from '../zones/entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { LaneSafetyService } from './lane-safety.service';
import type { CreateCargoDto, ListCargosQueryDto } from './cargo.dto';

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
    {} as unknown as Repository<TaskStatusTransitionEntity>,
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

const storedCargo = (id: string, itemCode: string): CargoEntity =>
  ({
    id,
    itemCode,
    sourcePointName: 'P-B',
    sourcePickupLocationName: 'loc-B',
    destinationLocationName: null,
    status: CargoStatus.ACTIVE,
    createdBy: null,
  }) as CargoEntity;

const storedTask = (
  cargoId: string,
  status: TaskStatus,
  metadata: TransportTaskEntity['metadata'] = {},
): TransportTaskEntity =>
  ({ id: `task-${cargoId}`, cargoId, status, metadata }) as TransportTaskEntity;

function listSetup(
  cargos: CargoEntity[] = [],
  tasks: TransportTaskEntity[] = [],
) {
  const conditions: string[] = [];
  const parameters: Record<string, unknown> = {};
  const paging = { skip: null as number | null, take: null as number | null };

  const builder = {
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([cargos, cargos.length]),
  };
  builder.andWhere.mockImplementation(
    (condition: string, params: Record<string, unknown> = {}) => {
      conditions.push(condition);
      Object.assign(parameters, params);
      return builder;
    },
  );
  builder.orderBy.mockReturnValue(builder);
  builder.skip.mockImplementation((value: number) => {
    paging.skip = value;
    return builder;
  });
  builder.take.mockImplementation((value: number) => {
    paging.take = value;
    return builder;
  });

  const cargoRepo = { createQueryBuilder: jest.fn().mockReturnValue(builder) };
  const taskRepo = { find: jest.fn().mockResolvedValue(tasks) };
  const kernelApi = { findPointForLocation: jest.fn().mockResolvedValue(null) };

  const svc = new CargoService(
    cargoRepo as unknown as Repository<CargoEntity>,
    taskRepo as unknown as Repository<TransportTaskEntity>,
    {} as unknown as Repository<TaskStatusTransitionEntity>,
    {} as unknown as Repository<ZoneEntity>,
    {} as unknown as DataSource,
    kernelApi as unknown as KernelApiService,
    {} as unknown as TransportTaskService,
    {} as unknown as LaneSafetyService,
  );

  const listWith = (query: ListCargosQueryDto = {}) => svc.list(query);
  const conditionMatching = (needle: string) =>
    conditions.find((condition) => condition.includes(needle));

  return { svc, listWith, conditions, conditionMatching, parameters, paging };
}

describe('CargoService.list', () => {
  it('returns the first page with no filter applied', async () => {
    const { listWith, conditions, paging } = listSetup([
      storedCargo('c-1', 'BOX-1'),
    ]);

    const result = await listWith();

    expect(conditions).toHaveLength(0);
    expect(paging).toEqual({ skip: 0, take: 20 });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.cargos.map((cargo) => cargo.itemCode)).toEqual(['BOX-1']);
  });

  it('keeps filtering by cargo status', async () => {
    const { listWith, conditionMatching, parameters } = listSetup();

    await listWith({ status: CargoStatus.DELIVERED });

    expect(conditionMatching('cargo.status')).toBeDefined();
    expect(parameters.status).toBe(CargoStatus.DELIVERED);
  });

  it('searches item code, source point and destination location at once', async () => {
    const { listWith, conditionMatching, parameters } = listSetup();

    await listWith({ search: '  box-1 ' });

    const condition = conditionMatching('ILIKE');
    expect(condition).toContain('cargo.itemCode');
    expect(condition).toContain('cargo.sourcePointName');
    expect(condition).toContain('cargo.destinationLocationName');
    expect(parameters.search).toBe('%box-1%');
  });

  it('filters by the task status of the newest task of each cargo', async () => {
    const { listWith, conditionMatching, parameters } = listSetup();

    await listWith({ taskStatus: TaskStatus.BLOCKED });

    const condition = conditionMatching('transport_requests');
    expect(condition).toContain('EXISTS');
    expect(condition).toContain('MAX(any_task.created_at)');
    expect(parameters.taskStatus).toBe(TaskStatus.BLOCKED);
  });

  it('combines every filter into one query', async () => {
    const { listWith, conditions } = listSetup();

    await listWith({
      status: CargoStatus.ACTIVE,
      taskStatus: TaskStatus.READY_TO_ASSIGN,
      search: 'box',
    });

    expect(conditions).toHaveLength(3);
  });

  it('translates page and limit into skip and take', async () => {
    const { listWith, paging } = listSetup();

    const result = await listWith({ page: 3, limit: 50 });

    expect(paging).toEqual({ skip: 100, take: 50 });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('surfaces the block reason of the linked task', async () => {
    const blocked = storedTask('c-1', TaskStatus.BLOCKED, {
      blockedReason: 'Blocked by cargo at loc-front',
    });
    const { listWith } = listSetup([storedCargo('c-1', 'BOX-1')], [blocked]);

    const result = await listWith({ taskStatus: TaskStatus.BLOCKED });

    expect(result.cargos[0].taskStatus).toBe(TaskStatus.BLOCKED);
    expect(result.cargos[0].blockedReason).toBe(
      'Blocked by cargo at loc-front',
    );
  });

  it('reports no block reason for a task that carries none', async () => {
    const { listWith } = listSetup(
      [storedCargo('c-1', 'BOX-1')],
      [storedTask('c-1', TaskStatus.DELIVERING)],
    );

    const result = await listWith();

    expect(result.cargos[0].blockedReason).toBeNull();
  });
});

const ASSIGNMENT_CONTEXT = {
  to1Name: 'PICKUP-V1-loc-B-abc',
  distanceToSource: 1200,
  matcher: 'hungarian',
  batchSize: 3,
  altVehicleName: 'V2',
  altDistanceToSource: 900,
  approachDistance: 4500,
};

const assignmentTransition = (
  context: Record<string, unknown>,
): TaskStatusTransitionEntity => ({
  id: '42',
  taskId: 'task-c-1',
  fromStatus: TaskStatus.READY_TO_ASSIGN,
  toStatus: TaskStatus.PICKING_UP,
  trigger: 'ASSIGNMENT_ENGINE',
  vehicleName: 'V1',
  reason: null,
  context,
  occurredAt: new Date('2026-08-04T10:00:00.000Z'),
});

interface DecisionSetupOptions {
  cargo?: CargoEntity | null;
  task?: TransportTaskEntity | null;
  transition?: TaskStatusTransitionEntity | null;
}

function decisionSetup(options: DecisionSetupOptions = {}) {
  const cargo =
    options.cargo === undefined ? storedCargo('c-1', 'BOX-1') : options.cargo;
  const task =
    options.task === undefined
      ? storedTask('c-1', TaskStatus.PICKING_UP)
      : options.task;
  const transition =
    options.transition === undefined
      ? assignmentTransition(ASSIGNMENT_CONTEXT)
      : options.transition;

  const cargoRepo = { findOne: jest.fn().mockResolvedValue(cargo) };
  const taskRepo = { findOne: jest.fn().mockResolvedValue(task) };
  const transitionRepo = { findOne: jest.fn().mockResolvedValue(transition) };

  const svc = new CargoService(
    cargoRepo as unknown as Repository<CargoEntity>,
    taskRepo as unknown as Repository<TransportTaskEntity>,
    transitionRepo as unknown as Repository<TaskStatusTransitionEntity>,
    {} as unknown as Repository<ZoneEntity>,
    {} as unknown as DataSource,
    {} as unknown as KernelApiService,
    {} as unknown as TransportTaskService,
    {} as unknown as LaneSafetyService,
  );

  return { svc, transitionRepo };
}

describe('CargoService.getAssignmentDecision', () => {
  it('reads the assignment transition of the task', async () => {
    const { svc, transitionRepo } = decisionSetup();

    await svc.getAssignmentDecision('c-1');

    expect(transitionRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task-c-1',
          trigger: 'ASSIGNMENT_ENGINE',
          toStatus: TaskStatus.PICKING_UP,
        },
      }),
    );
  });

  it('reports the matcher, the batch it belonged to and both distances', async () => {
    const { svc } = decisionSetup();

    const decision = await svc.getAssignmentDecision('c-1');

    expect(decision).toEqual({
      cargoId: 'c-1',
      taskId: 'task-c-1',
      decidedAt: new Date('2026-08-04T10:00:00.000Z'),
      vehicleName: 'V1',
      matcher: 'hungarian',
      matchedRequestCount: 3,
      distanceToSource: 1200,
      approachDistance: 4500,
      alternative: {
        matcher: 'greedy',
        vehicleName: 'V2',
        distanceToSource: 900,
      },
    });
  });

  it('names hungarian as the alternative when greedy made the decision', async () => {
    const { svc } = decisionSetup({
      transition: assignmentTransition({
        ...ASSIGNMENT_CONTEXT,
        matcher: 'greedy',
      }),
    });

    const decision = await svc.getAssignmentDecision('c-1');

    expect(decision.matcher).toBe('greedy');
    expect(decision.alternative?.matcher).toBe('hungarian');
  });

  it('omits the alternative when the other matcher chose no vehicle', async () => {
    const { svc } = decisionSetup({
      transition: assignmentTransition({
        ...ASSIGNMENT_CONTEXT,
        altVehicleName: null,
        altDistanceToSource: null,
      }),
    });

    const decision = await svc.getAssignmentDecision('c-1');

    expect(decision.alternative).toBeNull();
  });

  it('reports missing measurements as null instead of guessing', async () => {
    const { svc } = decisionSetup({
      transition: assignmentTransition({ matcher: 'hungarian' }),
    });

    const decision = await svc.getAssignmentDecision('c-1');

    expect(decision.matchedRequestCount).toBeNull();
    expect(decision.distanceToSource).toBeNull();
    expect(decision.approachDistance).toBeNull();
    expect(decision.alternative).toBeNull();
  });

  it('rejects an unknown cargo', async () => {
    const { svc } = decisionSetup({ cargo: null });

    await expect(svc.getAssignmentDecision('c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a cargo with no transport request', async () => {
    const { svc } = decisionSetup({ task: null });

    await expect(svc.getAssignmentDecision('c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a request that has not been assigned yet', async () => {
    const { svc } = decisionSetup({ transition: null });

    await expect(svc.getAssignmentDecision('c-1')).rejects.toThrow(
      /not been assigned/,
    );
  });
});
