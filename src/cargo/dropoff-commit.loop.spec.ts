import { DropoffCommitLoop } from './dropoff-commit.loop';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';
import type { SlotCommitResult } from './slot-reservation.service';

const GATE = 'S1';
const INSIDE = 'S3';
const OUTSIDE = '0005';

const LAYOUT = {
  columns: [],
  entryPoints: [GATE],
  memberPointNames: new Set([GATE, INSIDE]),
  strandedLocationNames: [],
};

function makeLoop(
  options: {
    position?: string;
    cargo?: Record<string, unknown> | null;
    commit?: SlotCommitResult | null;
    victimTask?: Record<string, unknown> | null;
  } = {},
) {
  const task = {
    id: 'task-1',
    status: TaskStatus.DELIVERING,
    cargoId: 'cargo-1',
    metadata: { assignedVehicleName: 'V1', to3Name: 'DROPOFF-V1-old' },
  };
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
    find: jest.fn().mockResolvedValue([task]),
    findOne: jest.fn().mockResolvedValue(victimTask),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const cargoRepo = {
    findOne: jest.fn().mockResolvedValue(
      options.cargo === null
        ? null
        : {
            id: 'cargo-1',
            destinationZoneId: 'zone-1',
            destinationLocationName: null,
            reservedLocationName: 'D3',
            status: CargoStatus.ACTIVE,
            ...options.cargo,
          },
    ),
  };
  const zoneRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'zone-1', name: 'zone_1' }),
  };
  const vehicleStore = {
    get: jest
      .fn()
      .mockReturnValue({ currentPosition: options.position ?? OUTSIDE }),
  };
  const deliverySlotEngine = { layoutFor: jest.fn().mockResolvedValue(LAYOUT) };
  const slotReservation = {
    commit: jest
      .fn()
      .mockResolvedValue(
        options.commit === undefined
          ? { slot: 'D3', keptOwnReservation: true, displaced: null }
          : options.commit,
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

  return { loop, taskRepo, slotReservation, dropoffOrder, task, victimTask };
}

describe('DropoffCommitLoop trigger', () => {
  it('commits with a swap allowed while the vehicle still sits on the gate', async () => {
    const { loop, slotReservation } = makeLoop({ position: GATE });

    await loop.tick();

    expect(slotReservation.commit).toHaveBeenCalledWith(
      'cargo-1',
      expect.objectContaining({ id: 'zone-1' }),
      true,
    );
  });

  it('still commits once the vehicle is inside the zone, but forbids the swap', async () => {
    const { loop, slotReservation } = makeLoop({ position: INSIDE });

    await loop.tick();

    expect(slotReservation.commit).toHaveBeenCalledWith(
      'cargo-1',
      expect.anything(),
      false,
    );
  });

  it('leaves a vehicle that has not reached the zone alone', async () => {
    const { loop, slotReservation } = makeLoop({ position: OUTSIDE });

    await loop.tick();

    expect(slotReservation.commit).not.toHaveBeenCalled();
  });

  it('skips a cargo whose slot is already committed', async () => {
    const { loop, slotReservation } = makeLoop({
      position: GATE,
      cargo: { destinationLocationName: 'D3' },
    });

    await loop.tick();

    expect(slotReservation.commit).not.toHaveBeenCalled();
  });
});

describe('DropoffCommitLoop order re-issue', () => {
  it('leaves the order alone when the commit matches the reservation', async () => {
    const { loop, dropoffOrder } = makeLoop({ position: GATE });

    await loop.tick();

    expect(dropoffOrder.reissue).not.toHaveBeenCalled();
  });

  it('re-aims the committing vehicle when it took a different slot', async () => {
    const { loop, dropoffOrder, task } = makeLoop({
      position: GATE,
      commit: { slot: 'D2', keptOwnReservation: false, displaced: null },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(task, 'V1', 'D2');
  });

  it('re-aims the cargo it stole the slot from', async () => {
    const { loop, dropoffOrder, victimTask } = makeLoop({
      position: GATE,
      commit: {
        slot: 'D3',
        keptOwnReservation: false,
        displaced: {
          cargoId: 'cargo-2',
          lostSlot: 'D3',
          replacementSlot: 'D2',
        },
      },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(victimTask, 'V2', 'D2');
  });

  it('counts the swap on the task it displaced', async () => {
    const { loop, taskRepo } = makeLoop({
      position: GATE,
      commit: {
        slot: 'D3',
        keptOwnReservation: false,
        displaced: {
          cargoId: 'cargo-2',
          lostSlot: 'D3',
          replacementSlot: 'D2',
        },
      },
    });

    await loop.tick();

    const saved = taskRepo.save.mock.calls[0][0] as {
      metadata: { swapCount: number };
    };
    expect(saved.metadata.swapCount).toBe(1);
  });

  it('does not re-aim a displaced cargo that has nowhere left to go', async () => {
    const { loop, dropoffOrder } = makeLoop({
      position: GATE,
      commit: {
        slot: 'D3',
        keptOwnReservation: true,
        displaced: {
          cargoId: 'cargo-2',
          lostSlot: 'D3',
          replacementSlot: null,
        },
      },
    });

    await loop.tick();

    expect(dropoffOrder.reissue).not.toHaveBeenCalled();
  });
});
