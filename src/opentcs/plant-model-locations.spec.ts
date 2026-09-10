import { upsertMemberLocations } from './plant-model-locations';
import type { KernelApiService } from './kernel-api.service';

interface PushedModel {
  locations: Array<Record<string, unknown>>;
}

function kernelWith(model: unknown) {
  const putRawPlantModel = jest.fn().mockResolvedValue(undefined);
  const api = {
    getRawPlantModel: jest.fn().mockResolvedValue(model),
    putRawPlantModel,
  } as unknown as KernelApiService;
  return {
    api,
    pushed: () => putRawPlantModel.mock.calls[0][0] as PushedModel,
  };
}

const modelWith = (locations: Array<Record<string, unknown>>) => ({
  name: 'v7',
  points: [
    { name: '3003', position: { x: 100, y: 200 } },
    { name: '3004', position: { x: 100, y: 1000 } },
  ],
  locations,
});

describe('upsertMemberLocations', () => {
  it('creates a location with the type the zone asked for', async () => {
    const { api, pushed } = kernelWith(modelWith([]));

    await upsertMemberLocations(api, [
      { locationName: 'location_3003', pointName: '3003', type: 'Drop off' },
    ]);

    expect(pushed().locations).toHaveLength(1);
    expect(pushed().locations[0].typeName).toBe('Drop off');
  });

  it('retypes a location the map already holds under the other type', async () => {
    const { api, pushed } = kernelWith(
      modelWith([
        {
          name: 'location_3003',
          typeName: 'Pick up',
          links: [{ pointName: '3003', allowedOperations: [] }],
        },
      ]),
    );

    await upsertMemberLocations(api, [
      { locationName: 'location_3003', pointName: '3003', type: 'Drop off' },
    ]);

    expect(pushed().locations).toHaveLength(1);
    expect(pushed().locations[0].typeName).toBe('Drop off');
  });

  it('retypes every member of the zone, not just the first', async () => {
    const { api, pushed } = kernelWith(
      modelWith([
        {
          name: 'location_3003',
          typeName: 'Pick up',
          links: [{ pointName: '3003', allowedOperations: [] }],
        },
        {
          name: 'location_3004',
          typeName: 'Pick up',
          links: [{ pointName: '3004', allowedOperations: [] }],
        },
      ]),
    );

    await upsertMemberLocations(api, [
      { locationName: 'location_3003', pointName: '3003', type: 'Drop off' },
      { locationName: 'location_3004', pointName: '3004', type: 'Drop off' },
    ]);

    expect(
      pushed().locations.map((location) => location.typeName),
    ).toEqual(['Drop off', 'Drop off']);
  });
});
