import { ApproachPointService } from './approach-point.service';
import type { ZoneEntity } from '../zones/entities/zone.entity';

const oneWay = (srcPointName: string, destPointName: string) => ({
  srcPointName,
  destPointName,
  maxVelocity: 1,
  maxReverseVelocity: 0,
});

const plantModel = {
  paths: [
    oneWay('0012', '3065'),
    oneWay('0013', '3073'),
    oneWay('3065', '3066'),
    oneWay('3073', '3074'),
  ],
  locations: [
    { name: 'location_3065', links: [{ pointName: '3065' }] },
    { name: 'location_3066', links: [{ pointName: '3066' }] },
    { name: 'location_3073', links: [{ pointName: '3073' }] },
    { name: 'location_3074', links: [{ pointName: '3074' }] },
  ],
};

const zone = {
  name: 'zone_10',
  members: [
    { locationName: 'location_3065' },
    { locationName: 'location_3066' },
    { locationName: 'location_3073' },
    { locationName: 'location_3074' },
  ],
} as ZoneEntity;

function setup(routes: Array<{ destinationPoint: string; costs: number }>) {
  const kernelApi = {
    getPlantModel: jest.fn().mockResolvedValue(plantModel),
    computeRoutes: jest
      .fn()
      .mockResolvedValue(routes.map((r) => ({ ...r, steps: [] }))),
  };
  return {
    kernelApi,
    service: new ApproachPointService(kernelApi as never),
  };
}

describe('ApproachPointService', () => {
  it('queries the kernel for the zone feeder heads only, not every member', async () => {
    const { service, kernelApi } = setup([
      { destinationPoint: '3065', costs: 100 },
      { destinationPoint: '3073', costs: 40 },
    ]);

    await service.pickFor(zone, 'V1');

    const [vehicleName, destinationPoints] =
      kernelApi.computeRoutes.mock.calls[0];
    expect(vehicleName).toBe('V1');
    expect([...(destinationPoints as string[])].sort()).toEqual([
      '3065',
      '3073',
    ]);
  });

  it('picks the cheapest reachable head', async () => {
    const { service } = setup([
      { destinationPoint: '3065', costs: 100 },
      { destinationPoint: '3073', costs: 40 },
    ]);

    expect(await service.pickFor(zone, 'V1')).toBe('3073');
  });

  it('never picks an unreachable head even when it sorts cheapest', async () => {
    const { service } = setup([
      { destinationPoint: '3065', costs: -1 },
      { destinationPoint: '3073', costs: 900 },
    ]);

    expect(await service.pickFor(zone, 'V1')).toBe('3073');
  });

  it('returns null when no head is reachable', async () => {
    const { service } = setup([
      { destinationPoint: '3065', costs: -1 },
      { destinationPoint: '3073', costs: -1 },
    ]);

    expect(await service.pickFor(zone, 'V1')).toBeNull();
  });

  it('returns null when the route query fails', async () => {
    const { service, kernelApi } = setup([]);
    kernelApi.computeRoutes.mockRejectedValue(new Error('kernel down'));

    expect(await service.pickFor(zone, 'V1')).toBeNull();
  });

  it('falls back to all member points when the zone has no feeder head', async () => {
    const { service, kernelApi } = setup([
      { destinationPoint: '3066', costs: 10 },
    ]);
    kernelApi.getPlantModel.mockResolvedValue({
      ...plantModel,
      paths: [oneWay('3065', '3066')],
    });

    expect(await service.pickFor(zone, 'V1')).toBe('3066');
    const [, destinationPoints] = kernelApi.computeRoutes.mock.calls[0];
    expect([...(destinationPoints as string[])].sort()).toEqual([
      '3065',
      '3066',
      '3073',
      '3074',
    ]);
  });
});
