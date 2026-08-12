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
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { TransportTaskService } from './transport-task.service';
import { TaskTerminationService } from './task-termination.service';
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
    getPlantModelName: jest.fn().mockResolvedValue('runtime-map'),
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
    {} as unknown as VehicleStateStore,
    {} as unknown as TaskTerminationService,
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
    {} as unknown as VehicleStateStore,
    {} as unknown as TaskTerminationService,
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
    {} as unknown as VehicleStateStore,
    {} as unknown as TaskTerminationService,
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

const DROP_SLOT = 'drop-1';
const DROP_POINT = 'P-D1';

interface RemoveSetupOptions {
  cargo?: CargoEntity | null;
  task?: TransportTaskEntity | null;
  allocated?: string[][] | null;
  connected?: boolean;
}

function removeSetup(options: RemoveSetupOptions = {}) {
  const cargo =
    options.cargo === undefined ? storedCargo('c-1', 'BOX-1') : options.cargo;
  const task = options.task ?? null;

  const cargoRepo = {
    findOne: jest.fn().mockResolvedValue(cargo),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };
  const taskRepo = { findOne: jest.fn().mockResolvedValue(task) };
  const kernelApi = {
    findPointForLocation: jest.fn().mockResolvedValue(DROP_POINT),
    getVehicleStates: jest.fn().mockResolvedValue([]),
  };
  const vehicleStore = {
    isConnected: jest.fn().mockReturnValue(options.connected ?? true),
    get: jest
      .fn()
      .mockReturnValue(
        options.allocated === null
          ? undefined
          : { allocatedResources: options.allocated ?? [] },
      ),
  };
  const taskTermination = { terminate: jest.fn().mockResolvedValue(undefined) };

  const svc = new CargoService(
    cargoRepo as unknown as Repository<CargoEntity>,
    taskRepo as unknown as Repository<TransportTaskEntity>,
    {} as unknown as Repository<TaskStatusTransitionEntity>,
    {} as unknown as Repository<ZoneEntity>,
    {} as unknown as DataSource,
    kernelApi as unknown as KernelApiService,
    {} as unknown as TransportTaskService,
    {} as unknown as LaneSafetyService,
    vehicleStore as unknown as VehicleStateStore,
    taskTermination as unknown as TaskTerminationService,
  );

  return { svc, cargoRepo, taskRepo, taskTermination, kernelApi };
}

const droppingOffTask = (metadata: TransportTaskEntity['metadata'] = {}) =>
  storedTask('c-1', TaskStatus.DELIVERING, {
    assignedVehicleName: 'V1',
    to3Name: 'DROPOFF-V1-drop-1-uuid',
    ...metadata,
  });

const cargoHeadingTo = (slot: string): CargoEntity => ({
  ...storedCargo('c-1', 'BOX-1'),
  destinationLocationName: slot,
});

describe('CargoService.remove', () => {
  it('deletes a cargo that never got a transport request', async () => {
    const { svc, cargoRepo, taskTermination } = removeSetup();

    await expect(svc.remove('c-1')).resolves.toEqual({
      message: 'Cargo deleted.',
    });

    expect(taskTermination.terminate).not.toHaveBeenCalled();
    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });

  it('rejects a cargo that does not exist', async () => {
    const { svc, cargoRepo } = removeSetup({ cargo: null });

    await expect(svc.remove('c-1')).rejects.toBeInstanceOf(NotFoundException);

    expect(cargoRepo.softDelete).not.toHaveBeenCalled();
  });

  it('fails the newest task of the cargo', async () => {
    const { svc, taskRepo, taskTermination } = removeSetup({
      task: storedTask('c-1', TaskStatus.READY_TO_ASSIGN),
    });

    await svc.remove('c-1');

    expect(taskRepo.findOne).toHaveBeenCalledWith({
      where: { cargoId: 'c-1' },
      order: { createdAt: 'DESC' },
    });
    expect(taskTermination.terminate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-c-1' }),
      TaskStatus.FAILED,
      { trigger: 'API', reason: 'cargo deleted' },
    );
  });

  it('deletes while the AGV is still driving to the pickup point', async () => {
    const { svc, cargoRepo, taskTermination } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      allocated: [['P-Z'], ['P-Z --- P-Y']],
    });

    await svc.remove('c-1');

    expect(taskTermination.terminate).toHaveBeenCalled();
    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });

  it('refuses once the AGV holds the pickup point', async () => {
    const { svc, cargoRepo, taskTermination } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      allocated: [['P-B']],
    });

    await expect(svc.remove('c-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(taskTermination.terminate).not.toHaveBeenCalled();
    expect(cargoRepo.softDelete).not.toHaveBeenCalled();
  });

  it('refuses once the AGV holds the drop-off point', async () => {
    const { svc, cargoRepo } = removeSetup({
      cargo: cargoHeadingTo(DROP_SLOT),
      task: droppingOffTask(),
      allocated: [[DROP_POINT]],
    });

    await expect(svc.remove('c-1')).rejects.toThrow(/V1/);

    expect(cargoRepo.softDelete).not.toHaveBeenCalled();
  });

  it('deletes once the load is down and the retreat leg is running', async () => {
    const { svc, cargoRepo } = removeSetup({
      cargo: cargoHeadingTo(DROP_SLOT),
      task: droppingOffTask({ unloadedAt: '2026-08-12T10:00:00.000Z' }),
      allocated: [[DROP_POINT]],
    });

    await svc.remove('c-1');

    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });

  it('reads a path resource as a path, not as the point it leads to', async () => {
    const { svc, cargoRepo } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      allocated: [['P-A --- P-B']],
    });

    await svc.remove('c-1');

    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });

  it('deletes when the fleet state cannot be read at all', async () => {
    const { svc, cargoRepo } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      allocated: null,
    });

    await svc.remove('c-1');

    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });

  it('falls back to the kernel when the event stream is down', async () => {
    const { svc, cargoRepo, kernelApi } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      connected: false,
    });
    kernelApi.getVehicleStates.mockResolvedValue([
      { name: 'V1', allocatedResources: [['P-B']] },
    ]);

    await expect(svc.remove('c-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(cargoRepo.softDelete).not.toHaveBeenCalled();
  });

  it('deletes when the kernel cannot be reached either', async () => {
    const { svc, cargoRepo, kernelApi } = removeSetup({
      task: storedTask('c-1', TaskStatus.PICKING_UP, {
        assignedVehicleName: 'V1',
      }),
      connected: false,
    });
    kernelApi.getVehicleStates.mockRejectedValue(new Error('kernel down'));

    await svc.remove('c-1');

    expect(cargoRepo.softDelete).toHaveBeenCalledWith('c-1');
  });
});
