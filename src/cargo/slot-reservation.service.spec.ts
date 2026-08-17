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
  return { service, cargos, manager };
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

    const result = await service.commit('c1', ZONE, true);

    expect(result).toMatchObject({ slot: 'D3', keptOwnReservation: true });
    expect(cargos[0].destinationLocationName).toBe('D3');
    expect(cargos[0].reservedLocationName).toBeNull();
  });

  it('lets whoever reaches the gate first take the better slot', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, true);

    expect(result).toMatchObject({ slot: 'D3', keptOwnReservation: false });
    expect(cargos[1].destinationLocationName).toBe('D3');
    expect(result?.displaced).toMatchObject({
      cargoId: 'c1',
      lostSlot: 'D3',
    });
  });

  it('always leaves the displaced cargo a slot to go to', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, true);

    expect(result?.displaced?.replacementSlot).toBe('D2');
    expect(cargos[0].reservedLocationName).toBe('D2');
  });

  it('keeps its own reservation once the vehicle is past the gate', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, false);

    expect(result).toMatchObject({ slot: 'D2', keptOwnReservation: true });
    expect(result?.displaced).toBeNull();
    expect(cargos[0].reservedLocationName).toBe('D3');
  });

  it('is idempotent once the slot is committed', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'S2' }),
    ]);

    const result = await service.commit('c1', ZONE, true);

    expect(result).toEqual({
      slot: 'S2',
      keptOwnReservation: true,
      displaced: null,
    });
  });

  it('never offers a slot another cargo has already committed', async () => {
    const { service } = makeService([
      cargo('c1', { destinationLocationName: 'D3' }),
      cargo('c2', { reservedLocationName: 'D2' }),
    ]);

    const result = await service.commit('c2', ZONE, true);

    expect(result?.slot).toBe('D2');
  });

  it('bumps the decision counter on every cargo it touches', async () => {
    const { service, cargos } = makeService([
      cargo('c1', { reservedLocationName: 'D3', slotDecisionSeq: 4 }),
      cargo('c2', { reservedLocationName: 'D2', slotDecisionSeq: 7 }),
    ]);

    await service.commit('c2', ZONE, true);

    expect(cargos[0].slotDecisionSeq).toBe(5);
    expect(cargos[1].slotDecisionSeq).toBe(8);
  });
});
