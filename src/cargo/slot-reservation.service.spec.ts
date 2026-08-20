import { SlotReservationService } from './slot-reservation.service';
import { CargoStatus } from './entities/cargo.entity';
import { rankSlots, type ZoneSlotLayout } from './domain/zone-slot-layout';

const ZONE = { id: 'zone-1', name: 'zone_1' } as never;

function slot(name: string) {
  return { locationName: name, pointName: name };
}

const LAYOUT: ZoneSlotLayout = {
  columns: [
    [slot('D3'), slot('D2'), slot('D1')],
    [slot('S3'), slot('S2'), slot('S1')],
  ],
  lanes: [
    {
      axis: 2000,
      slots: [slot('D3'), slot('D2'), slot('D1')],
      axisPoints: ['D3', 'D2', 'D1', 'WD1', 'WD2'],
    },
    {
      axis: 1000,
      slots: [slot('S3'), slot('S2'), slot('S1')],
      axisPoints: ['S3', 'S2', 'S1', 'WS1', 'WS2'],
    },
  ],
  entryPoints: ['D1', 'S1'],
  memberPointNames: new Set(['D1', 'D2', 'D3', 'S1', 'S2', 'S3']),
  strandedLocationNames: [],
};

interface FakeCargo {
  id: string;
  destinationZoneId: string | null;
  destinationLocationName: string | null;
  reservedLocationName: string | null;
  slotDecisionSeq: number;
  status: CargoStatus;
}

function cargo(id: string, overrides: Partial<FakeCargo> = {}): FakeCargo {
  return {
    id,
    destinationZoneId: 'zone-1',
    destinationLocationName: null,
    reservedLocationName: null,
    slotDecisionSeq: 0,
    status: CargoStatus.ACTIVE,
    ...overrides,
  };
}

const LANE_D = LAYOUT.lanes[0];
const LANE_S = LAYOUT.lanes[1];

function options(
  blockedLocationNames: ReadonlySet<string> = new Set(),
  lane = LANE_D,
) {
  return { blockedLocationNames, lane };
}

function makeService(cargos: FakeCargo[]) {
  const repo = {
    findOne: ({ where }: { where: { id: string } }) =>
      Promise.resolve(cargos.find((c) => c.id === where.id) ?? null),
    find: ({ where }: { where: { destinationZoneId: string } }) =>
      Promise.resolve(
        cargos.filter(
          (c) =>
            c.destinationZoneId === where.destinationZoneId &&
            (c.status === CargoStatus.ACTIVE ||
              c.status === CargoStatus.DELIVERED),
        ),
      ),
    update: (id: string, patch: Partial<FakeCargo>) => {
      Object.assign(cargos.find((c) => c.id === id) as FakeCargo, patch);
      return Promise.resolve(undefined);
    },
  };
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: () => repo,
  };
  const dataSource = {
    transaction: (run: (m: unknown) => Promise<unknown>) => run(manager),
    getRepository: () => repo,
  };
  const deliverySlotEngine = {
    layoutFor: jest.fn().mockResolvedValue(LAYOUT),
    rank: (layout: ZoneSlotLayout, occupied: ReadonlySet<string>) =>
      rankSlots(layout, occupied),
  };
  const service = new SlotReservationService(
    dataSource as never,
    deliverySlotEngine as never,
  );
  return { service, cargos, manager, deliverySlotEngine };
}

describe('SlotReservationService.reserve', () => {
  it('hands out the far end of the deep column first', async () => {
    const { service } = makeService([cargo('c1')]);

    await expect(service.reserve('c1', ZONE)).resolves.toBe('D3');
  });

  it('never hands the same slot to two cargos', async () => {
    const { service, cargos } = makeService([cargo('c1'), cargo('c2')]);

    const first = await service.reserve('c1', ZONE);
    const second = await service.reserve('c2', ZONE);

    expect(first).not.toBe(second);
    expect(cargos.map((c) => c.reservedLocationName)).toEqual([first, second]);
  });

  it('keeps the reservation it already holds', async () => {
    const { service } = makeService([
      cargo('c1', { reservedLocationName: 'S1' }),
    ]);

    await expect(service.reserve('c1', ZONE)).resolves.toBe('S1');
  });

  it('reports the committed slot when the cargo is already past reservation', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D2' }),
    ]);

    await expect(service.reserve('c1', ZONE)).resolves.toBe('D2');
  });

  it('queues behind the commit instead of taking a cell it still needs', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D3' }),
      cargo('c2'),
    ]);

    await expect(service.reserve('c2', ZONE)).resolves.toBe('WD1');
  });

  it('puts the next one in the queue one step further back', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'WD1' }),
      cargo('c3'),
    ]);

    await expect(service.reserve('c3', ZONE)).resolves.toBe('WD2');
  });

  it('moves to the next lane once the buffer is reached', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'WD1' }),
      cargo('c3', { reservedLocationName: 'WD2' }),
      cargo('c4'),
    ]);

    await expect(service.reserve('c4', ZONE)).resolves.toBe('S3');
  });

  it('takes the advisory lock on the zone before it reads', async () => {
    const { service, manager } = makeService([cargo('c1')]);

    await service.reserve('c1', ZONE);

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      ['zone-1'],
    );
  });
});

describe('SlotReservationService.commit', () => {
  it('takes the best free slot and marks it committed', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
    ]);

    const result = await service.commit('c1', ZONE, options());

    expect(result).toMatchObject({ slot: 'D3', keptOwnReservation: true });
    expect(cargos[0].destinationLocationName).toBe('D3');
    expect(cargos[0].reservedLocationName).toBeNull();
  });

  it('lets whoever reaches the gate first take the better slot', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, options());

    expect(result).toMatchObject({ slot: 'D3', keptOwnReservation: false });
    expect(cargos[1].destinationLocationName).toBe('D3');
    expect(result?.displaced).toMatchObject({
      cargoId: 'c1',
      lostSlot: 'D3',
    });
  });

  it('leaves the displaced cargo a slot in the same lane', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, options());

    expect(result?.displaced?.replacementSlot).toBe('D2');
    expect(cargos[0].reservedLocationName).toBe('D2');
  });

  it('is idempotent once the slot is committed', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'S2' }),
    ]);

    const result = await service.commit('c1', ZONE, options());

    expect(result).toEqual({
      slot: 'S2',
      keptOwnReservation: true,
      displaced: null,
    });
  });

  it('offers nothing while the caller reports the lane still occupied', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit(
      'c2',
      ZONE,
      options(new Set(['D3', 'D2', 'D1'])),
    );

    expect(result).toBeNull();
  });

  it('always takes the best free slot, ignoring its own reservation', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D1' }),
    ]);

    const result = await service.commit('c1', ZONE, options());

    expect(result?.slot).toBe('D3');
    expect(cargos[0].destinationLocationName).toBe('D3');
  });

  it('never sends a vehicle to a lane it is not standing in', async () => {
    const { service } = makeService([cargo('c1')]);

    const result = await service.commit('c1', ZONE, options(new Set(), LANE_S));

    expect(result?.slot).toBe('S3');
  });

  it('waits rather than jump lanes when its own lane is busy', async () => {
    const { service } = makeService([cargo('c1')]);

    const result = await service.commit(
      'c1',
      ZONE,
      options(new Set(['D3', 'D2', 'D1'])),
    );

    expect(result).toBeNull();
  });

  it('commits nothing while every lane is busy', async () => {
    const { service } = makeService([cargo('c1')]);

    const result = await service.commit(
      'c1',
      ZONE,
      options(new Set(['D3', 'D2', 'D1', 'S3', 'S2', 'S1'])),
    );

    expect(result).toBeNull();
  });

  it('bumps the decision counter on every cargo it touches', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3', slotDecisionSeq: 4 }),
      cargo('c2', { reservedLocationName: 'D2', slotDecisionSeq: 7 }),
    ]);

    await service.commit('c2', ZONE, options());

    expect(cargos[0].slotDecisionSeq).toBe(5);
    expect(cargos[1].slotDecisionSeq).toBe(8);
  });
});

describe('SlotReservationService.commit in a lane deeper than the retreat', () => {
  const DEEP_SLOTS = ['P5', 'P4', 'P3', 'P2', 'P1'].map((pointName) => ({
    locationName: pointName,
    pointName,
  }));
  const DEEP_LANE = {
    axis: 3000,
    slots: DEEP_SLOTS,
    axisPoints: ['P5', 'P4', 'P3', 'P2', 'P1', 'WP1'],
  };
  const DEEP_LAYOUT: ZoneSlotLayout = {
    columns: [DEEP_SLOTS],
    lanes: [DEEP_LANE],
    entryPoints: ['P1'],
    memberPointNames: new Set(['P1', 'P2', 'P3', 'P4', 'P5']),
    strandedLocationNames: [],
  };

  function deepService(cargos: FakeCargo[]) {
    const made = makeService(cargos);
    made.deliverySlotEngine.layoutFor.mockResolvedValue(DEEP_LAYOUT);
    return made;
  }

  const deepOptions = (blocked: string[] = []) => ({
    blockedLocationNames: new Set(blocked),
    lane: DEEP_LANE,
  });

  it('waits while the vehicle ahead is still in the lane', async () => {
    const { service } = deepService([
      cargo('c1', { destinationLocationName: 'P5' }),
      cargo('c2', { reservedLocationName: 'P2' }),
    ]);

    const busy = deepOptions(['P5', 'P4', 'P3', 'P2', 'P1']);

    await expect(service.commit('c2', ZONE, busy)).resolves.toBeNull();
  });

  it('takes the cell right behind, the moment the lane reads clear', async () => {
    const { service, cargos } = deepService([
      cargo('c1', { destinationLocationName: 'P5' }),
      cargo('c2', { reservedLocationName: 'P2' }),
    ]);

    const result = await service.commit('c2', ZONE, deepOptions());

    expect(result?.slot).toBe('P4');
    expect(cargos[1].destinationLocationName).toBe('P4');
  });

  it('ignores its own reservation and never leaves a hole behind it', async () => {
    const { service } = deepService([
      cargo('c1', {
        destinationLocationName: 'P5',
        status: CargoStatus.DELIVERED,
      }),
      cargo('c2', { reservedLocationName: 'P2' }),
    ]);

    await expect(
      service.commit('c2', ZONE, deepOptions()),
    ).resolves.toMatchObject({ slot: 'P4' });
  });

  it('never reaches past an occupied cell to a deeper free one', async () => {
    const { service } = deepService([
      cargo('c1', { destinationLocationName: 'P3' }),
      cargo('c2'),
    ]);

    await expect(
      service.commit('c2', ZONE, deepOptions()),
    ).resolves.toMatchObject({ slot: 'P2' });
  });

  it('reports the lane full when the entrance cell is taken', async () => {
    const { service } = deepService([
      cargo('c1', {
        destinationLocationName: 'P1',
        status: CargoStatus.DELIVERED,
      }),
      cargo('c2'),
    ]);

    await expect(service.commit('c2', ZONE, deepOptions())).resolves.toBeNull();
  });
});
