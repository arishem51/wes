import { VehicleAimService, type AimedVehicle } from './vehicle-aim.service';
import type { ZoneSlotLayout } from './domain/zone-slot-layout';

const ZONE = { id: 'zone-1', name: 'zone_1' } as never;
const SLOT = 'location_P1';
const CORRIDOR = 'corr';

const DEEPER = 'location_P0';
const OTHER_LANE = 'location_Q1';

const LANE = {
  axis: 0,
  slots: [
    { locationName: DEEPER, pointName: 'P0' },
    { locationName: SLOT, pointName: 'P1' },
  ],
  axisPoints: ['P0', 'P1', CORRIDOR],
  axisAlong: [0, 1000],
};

const LAYOUT: ZoneSlotLayout = {
  mainlinePoints: new Set<string>(),
  columns: [LANE.slots, [{ locationName: OTHER_LANE, pointName: 'Q1' }]],
  lanes: [
    LANE,
    {
      axis: 1000,
      slots: [{ locationName: OTHER_LANE, pointName: 'Q1' }],
      axisPoints: ['Q1', 'corrQ'],
      axisAlong: [0, 1000],
    },
  ],
  entryPoints: ['P1', 'Q1'],
  memberPointNames: new Set(['P0', 'P1', 'Q1']),
  strandedLocationNames: [],
};

function setup(metadata: Record<string, unknown> = {}) {
  const slotReservation = {
    aimAt: jest.fn().mockResolvedValue(undefined),
    releaseCommit: jest.fn().mockResolvedValue(undefined),
  };
  const approachOrder = {
    aim: jest.fn().mockResolvedValue('APPROACH-new'),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const dropoffOrder = {
    issue: jest.fn().mockResolvedValue('DROPOFF-new'),
    reissue: jest.fn().mockResolvedValue('DROPOFF-new'),
  };
  const service = new VehicleAimService(
    slotReservation as never,
    approachOrder as never,
    dropoffOrder as never,
  );
  const aimed: AimedVehicle = {
    task: { id: 'task-1', metadata } as never,
    vehicle: 'V1',
    cargoId: 'cargo-1',
  };
  return { service, slotReservation, approachOrder, dropoffOrder, aimed };
}

describe('queueAt', () => {
  it('writes the reservation only after the kernel has the order', async () => {
    const { service, slotReservation, approachOrder, aimed } = setup();

    await service.queueAt(aimed, ZONE, LAYOUT, CORRIDOR);

    expect(approachOrder.aim.mock.invocationCallOrder[0]).toBeLessThan(
      slotReservation.aimAt.mock.invocationCallOrder[0],
    );
    expect(slotReservation.aimAt).toHaveBeenCalledWith(
      'cargo-1',
      CORRIDOR,
      ZONE,
    );
  });

  it('leaves the reservation alone when the order cannot be created', async () => {
    const { service, slotReservation, approachOrder, aimed } = setup();
    approachOrder.aim.mockResolvedValueOnce(null);

    expect(await service.queueAt(aimed, ZONE, LAYOUT, CORRIDOR)).toBe(false);
    expect(slotReservation.aimAt).not.toHaveBeenCalled();
  });

  it('sends a drop-off cell as a location and a corridor point as a point', async () => {
    const { service, approachOrder, aimed } = setup();

    await service.queueAt(aimed, ZONE, LAYOUT, SLOT);
    await service.queueAt(aimed, ZONE, LAYOUT, CORRIDOR);

    expect(approachOrder.aim.mock.calls[0][2]).toEqual({ locationName: SLOT });
    expect(approachOrder.aim.mock.calls[1][2]).toEqual({
      pointName: CORRIDOR,
    });
  });
});

describe('dropAt', () => {
  it('cancels the approach order even when the cell is further along the same lane', async () => {
    const { service, approachOrder, aimed } = setup({
      approachPointName: SLOT,
    });

    expect(await service.dropAt(aimed, ZONE, DEEPER, false)).toBe(true);
    expect(approachOrder.cancel).toHaveBeenCalledWith(aimed.task);
  });

  it('keeps it when the commit landed exactly where it was already heading', async () => {
    const { service, approachOrder, aimed } = setup({
      approachPointName: SLOT,
    });

    await service.dropAt(aimed, ZONE, SLOT, true);

    expect(approachOrder.cancel).not.toHaveBeenCalled();
  });

  it('cancels when the commit landed in a different lane', async () => {
    const { service, approachOrder, aimed } = setup({
      approachPointName: SLOT,
    });

    await service.dropAt(aimed, ZONE, OTHER_LANE, false);

    expect(approachOrder.cancel).toHaveBeenCalled();
  });

  it('cancels when the commit is behind where it was heading', async () => {
    const { service, approachOrder, aimed } = setup({
      approachPointName: DEEPER,
    });

    await service.dropAt(aimed, ZONE, SLOT, false);

    expect(approachOrder.cancel).toHaveBeenCalled();
  });

  it('cancels only after the drop-off order exists', async () => {
    const { service, dropoffOrder, approachOrder, aimed } = setup({
      approachPointName: SLOT,
    });

    await service.dropAt(aimed, ZONE, OTHER_LANE, false);

    expect(dropoffOrder.issue.mock.invocationCallOrder[0]).toBeLessThan(
      approachOrder.cancel.mock.invocationCallOrder[0],
    );
  });

  it('reuses the order in flight when the commit kept its own reservation', async () => {
    const { service, dropoffOrder, aimed } = setup({
      to3Name: 'DROPOFF-old',
      approachPointName: SLOT,
    });

    expect(await service.dropAt(aimed, ZONE, SLOT, true)).toBe(true);
    expect(dropoffOrder.issue).not.toHaveBeenCalled();
    expect(dropoffOrder.reissue).not.toHaveBeenCalled();
  });

  it('re-issues the order when the commit landed somewhere else', async () => {
    const { service, dropoffOrder, aimed } = setup({ to3Name: 'DROPOFF-old' });

    await service.dropAt(aimed, ZONE, SLOT, false);

    expect(dropoffOrder.reissue).toHaveBeenCalledWith(
      aimed.task,
      'V1',
      SLOT,
      ZONE,
    );
  });

  it('gives the slot back when the kernel refuses the order', async () => {
    const { service, dropoffOrder, slotReservation, aimed } = setup();
    dropoffOrder.issue.mockResolvedValueOnce(null);

    expect(await service.dropAt(aimed, ZONE, SLOT, false)).toBe(false);
    expect(slotReservation.releaseCommit).toHaveBeenCalledWith('cargo-1', ZONE);
  });

  it('keeps the vehicle on its approach order when the drop-off is refused', async () => {
    const { service, dropoffOrder, approachOrder, aimed } = setup({
      approachPointName: OTHER_LANE,
    });
    dropoffOrder.issue.mockResolvedValueOnce(null);

    await service.dropAt(aimed, ZONE, SLOT, false);

    expect(approachOrder.cancel).not.toHaveBeenCalled();
  });
});

describe('stopApproaching', () => {
  it('withdraws the approach order so the cell stops being claimed', async () => {
    const { service, approachOrder, aimed } = setup({
      approachPointName: SLOT,
    });

    await service.stopApproaching(aimed);

    expect(approachOrder.cancel).toHaveBeenCalledWith(aimed.task);
  });
});
