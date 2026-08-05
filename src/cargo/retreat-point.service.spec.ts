import { RetreatPointService } from './retreat-point.service';

const point = (name: string, x: number, y: number) => ({
  name,
  type: 'HALT_POSITION',
  position: { x, y },
  parkingPriority: null,
});

const bidirectional = (srcPointName: string, destPointName: string) => ({
  srcPointName,
  destPointName,
  length: 1000,
  maxVelocity: 10000,
  maxReverseVelocity: 10000,
  locked: false,
});

const plantModel = {
  points: [
    point('0091', 46000, 0),
    point('3001', 46000, -1000),
    point('3002', 46000, -2000),
    point('3003', 46000, -3000),
  ],
  paths: [
    bidirectional('0091', '3001'),
    bidirectional('3001', '3002'),
    bidirectional('3002', '3003'),
  ],
  locationTypes: [],
  locations: [],
};

function setup(overrides: Record<string, unknown> = {}) {
  const kernelApi = {
    findPointForLocation: jest.fn().mockResolvedValue('3003'),
    getPlantModelView: jest.fn().mockResolvedValue(plantModel),
    ...overrides,
  };
  return { kernelApi, service: new RetreatPointService(kernelApi as never) };
}

describe('RetreatPointService', () => {
  it('resolves every cell of the two-cell retreat behind the drop-off location', async () => {
    const { service, kernelApi } = setup();

    expect(await service.pathFor('location_3003')).toEqual(['3002', '3001']);
    expect(kernelApi.findPointForLocation).toHaveBeenCalledWith(
      'location_3003',
    );
  });

  it('reads the topology from the live kernel, never from a file', async () => {
    const { service, kernelApi } = setup();

    await service.pathFor('location_3003');

    expect(kernelApi.getPlantModelView).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit cell count', async () => {
    const { service } = setup();

    expect(await service.pathFor('location_3003', 1)).toEqual(['3002']);
    expect(await service.pathFor('location_3003', 3)).toEqual([
      '3002',
      '3001',
      '0091',
    ]);
  });

  it('returns null when the location has no linked point', async () => {
    const { service, kernelApi } = setup({
      findPointForLocation: jest.fn().mockResolvedValue(null),
    });

    expect(await service.pathFor('location_unknown')).toBeNull();
    expect(kernelApi.getPlantModelView).not.toHaveBeenCalled();
  });

  it('returns null when the plant model is unavailable', async () => {
    const { service } = setup({
      getPlantModelView: jest.fn().mockResolvedValue(null),
    });

    expect(await service.pathFor('location_3003')).toBeNull();
  });

  it('returns null when the topology has no full retreat behind the slot', async () => {
    const { service } = setup({
      findPointForLocation: jest.fn().mockResolvedValue('3001'),
    });

    expect(await service.pathFor('location_3001')).toBeNull();
  });
});
