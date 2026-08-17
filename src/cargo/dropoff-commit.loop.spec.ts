import { DropoffCommitLoop } from './dropoff-commit.loop';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';
import type { SlotCommitResult } from './slot-reservation.service';

const GATE = 'S1';
const INSIDE = 'D2';
const INSIDE_COLUMN = 0;
const OUTSIDE = '0005';

function slot(name: string) {
  return { locationName: name, pointName: name };
}

const LAYOUT = {
  columns: [
    [slot('D3'), slot('D2'), slot('D1')],
    [slot('S3'), slot('S2'), slot('S1')],
  ],
  entryPoints: [GATE, 'D1'],
  memberPointNames: new Set(['D1', 'D2', 'D3', 'S1', 'S2', 'S3']),
  strandedLocationNames: [],
};

const KEPT_OWN_SLOT: SlotCommitResult = {
  slot: 'D3',
  keptOwnReservation: true,
  displaced: null,
};

const STOLE_FROM_CARGO_2: SlotCommitResult = {
  slot: 'D3',
  keptOwnReservation: false,
  displaced: { cargoId: 'cargo-2', lostSlot: 'D3', replacementSlot: 'D2' },
};

interface FleetMember {
  vehicle: string;
  taskId: string;
  cargoId: string;
  position: string;
  cargo?: Record<string, unknown>;
}

function solo(
  position: string,
  cargo?: Record<string, unknown>,
): FleetMember[] {
  return [
    { vehicle: 'V1', taskId: 'task-1', cargoId: 'cargo-1', position, cargo },
  ];
}

function makeLoop(
  options: {
    fleet?: FleetMember[];
    commits?: Record<string, SlotCommitResult | null>;
    victimTask?: Record<string, unknown> | null;
  } = {},
) {
  const fleet = options.fleet ?? solo(OUTSIDE);
  const tasks = fleet.map((member) => ({
    id: member.taskId,
    status: TaskStatus.DELIVERING,
    cargoId: member.cargoId,
    metadata: {
      assignedVehicleName: member.vehicle,
      to3Name: `DROPOFF-${member.vehicle}-old`,
    },
  }));
  const cargos = fleet.map((member) => ({
    id: member.cargoId,
    destinationZoneId: 'zone-1',
    destinationLocationName: null,
    reservedLocationName: 'D3',
    status: CargoStatus.ACTIVE,
    ...member.cargo,
  }));
  const positionByVehicle = new Map(
    fleet.map((member) => [member.vehicle, member.position]),
  );
  const victimTask =
    options.victimTask === undefined
      ? {
          id: 'task-2',
          status: TaskStatus.DELIVERING,
          cargoId: 'cargo-2',
          metadata: { assignedVehicleName: 'V2', to3Name: 'DROPOFF-V2-old' },
        }
      : options.victimTask;

  const taskRepo = {
    find: jest.fn().mockResolvedValue(tasks),
    findOne: jest.fn().mockResolvedValue(victimTask),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const cargoRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(cargos.find((cargo) => cargo.id === where.id) ?? null),
    ),
  };
  const zoneRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'zone-1', name: 'zone_1' }),
  };
  const vehicleStore = {
    get: jest.fn((name: string) => ({
      currentPosition: positionByVehicle.get(name) ?? OUTSIDE,
    })),
  };
  const deliverySlotEngine = { layoutFor: jest.fn().mockResolvedValue(LAYOUT) };
  const slotReservation = {
    commit: jest.fn((cargoId: string) =>
      Promise.resolve(
        options.commits && cargoId in options.commits
          ? options.commits[cargoId]
          : KEPT_OWN_SLOT,
      ),
    ),
  };
  const dropoffOrder = { reissue: jest.fn().mockResolvedValue('DROPOFF-new') };

  const loop = new DropoffCommitLoop(
    taskRepo as never,
    cargoRepo as never,
    zoneRepo as never,
    {} as never,
    vehicleStore as never,
    deliverySlotEngine as never,
    slotReservation as never,
    dropoffOrder as never,
  );

  return { loop, taskRepo, slotReservation, dropoffOrder, tasks, victimTask };
}

describe('DropoffCommitLoop trigger', () => {
  it('commits with a swap allowed while the vehicle still sits on the gate', async () => {
    const { loop, slotReservation } = makeLoop({ fleet: solo(GATE) });

    await loop.tick();

    expect(slotReservation.commit).toHaveBeenCalledWith(
      'cargo-1',
      expect.objectContaining({ id: 'zone-1' }),
      { allowSwap: true, insideColumnByCargoId: new Map() },
    );
  });

  it('still commits once the vehicle is inside the zone, but forbids the swap', async () => {
    const { loop, slotReservation } = makeLoop({ fleet: solo(INSIDE) });

    await loop.tick();

    expect(slotReservation.commit).toHaveBeenCalledWith(
      'cargo-1',
      expect.anything(),
      {
        allowSwap: false,
        insideColumnByCargoId: new Map([['cargo-1', INSIDE_COLUMN]]),
      },
    );
  });

  it('leaves a vehicle that has not reached the zone alone', async () => {
    const { loop, slotReservation } = makeLoop({ fleet: solo(OUTSIDE) });

    await loop.tick();

    expect(slotReservation.commit).not.toHaveBeenCalled();
  });

  it('skips a cargo whose slot is already committed', async () => {
    const { loop, slotReservation } = makeLoop({
      fleet: solo(GATE, { destinationLocationName: 'D3' }),
    });

    await loop.tick();

    expect(slotReservation.commit).not.toHaveBeenCalled();
  });
});

describe('DropoffCommitLoop ordering', () => {
  it('runs the vehicles on the gate before the ones already inside a column', async () => {
    const { loop, slotReservation } = makeLoop({
      fleet: [
        {
          vehicle: 'V1',
          taskId: 'task-1',
          cargoId: 'cargo-1',
          position: INSIDE,
        },
        { vehicle: 'V2', taskId: 'task-2', cargoId: 'cargo-2', position: GATE },
      ],
    });

    await loop.tick();

    expect(slotReservation.commit.mock.calls.map((call) => call[0])).toEqual([
      'cargo-2',
      'cargo-1',
    ]);
  });

  it('tells the vehicle on the gate which columns are already driven into', async () => {
    const { loop, slotReservation } = makeLoop({
      fleet: [
        {
          vehicle: 'V1',
          taskId: 'task-1',
          cargoId: 'cargo-1',
          position: INSIDE,
        },
        { vehicle: 'V2', taskId: 'task-2', cargoId: 'cargo-2', position: GATE },
      ],
    });

    await loop.tick();

    expect(slotReservation.commit).toHaveBeenCalledWith(
      'cargo-2',
      expect.anything(),
      {
        allowSwap: true,
        insideColumnByCargoId: new Map([['cargo-1', INSIDE_COLUMN]]),
      },
    );
  });
});

describe('DropoffCommitLoop order re-issue', () => {
  it('leaves the order alone when the commit matches the reservation', async () => {
    const { loop, dropoffOrder } = makeLoop({ fleet: solo(GATE) });

    await loop.tick();

    expect(dropoffOrder.reissue).not.toHaveBeenCalled();
  });

  it('re-aims the committing vehicle when it took a different slot', async () => {
    const { loop, dropoffOrder, tasks } = makeLoop({
      fleet: solo(GATE),
      commits: {
        'cargo-1': { slot: 'D2', keptOwnReservation: false, displaced: null },
      },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(tasks[0], 'V1', 'D2');
  });

  it('re-aims the cargo it stole the slot from', async () => {
    const { loop, dropoffOrder, victimTask } = makeLoop({
      fleet: solo(GATE),
      commits: { 'cargo-1': STOLE_FROM_CARGO_2 },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(victimTask, 'V2', 'D2');
  });

  it('re-aims the displaced task this tick already holds instead of re-reading it', async () => {
    const { loop, taskRepo, dropoffOrder, tasks } = makeLoop({
      fleet: [
        { vehicle: 'V1', taskId: 'task-1', cargoId: 'cargo-1', position: GATE },
        { vehicle: 'V2', taskId: 'task-2', cargoId: 'cargo-2', position: GATE },
      ],
      commits: { 'cargo-1': STOLE_FROM_CARGO_2 },
      victimTask: null,
    });

    await loop.tick();

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(tasks[1], 'V2', 'D2');
    expect(taskRepo.findOne).not.toHaveBeenCalled();
  });

  it('counts the swap on the task it displaced', async () => {
    const { loop, taskRepo } = makeLoop({
      fleet: solo(GATE),
      commits: { 'cargo-1': STOLE_FROM_CARGO_2 },
    });

    await loop.tick();

    const saved = taskRepo.save.mock.calls[0][0] as {
      metadata: { swapCount: number };
    };
    expect(saved.metadata.swapCount).toBe(1);
  });

  it('does not re-aim a displaced cargo that has nowhere left to go', async () => {
    const { loop, dropoffOrder } = makeLoop({
      fleet: solo(GATE),
      commits: {
        'cargo-1': {
          slot: 'D3',
          keptOwnReservation: true,
          displaced: {
            cargoId: 'cargo-2',
            lostSlot: 'D3',
            replacementSlot: null,
          },
        },
      },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).not.toHaveBeenCalled();
  });
});
