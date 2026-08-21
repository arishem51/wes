import { Logger } from '@nestjs/common';
import { ZoneGeometryService } from './zone-geometry.service';

const ZONE = {
  id: 'zone-1',
  name: 'khu a',
  members: [
    { locationName: 'location_0100' },
    { locationName: 'location_0110' },
  ],
} as never;

function plantModel(aisleLink: {
  src: string;
  dest: string;
  maxVelocity: number;
  maxReverseVelocity: number;
}) {
  return {
    points: [
      { name: '0082', position: { x: 37000, y: 1000 } },
      { name: '0100', position: { x: 37000, y: 2000 } },
      { name: '0110', position: { x: 37000, y: 3000 } },
    ],
    paths: [
      {
        srcPointName: aisleLink.src,
        destPointName: aisleLink.dest,
        maxVelocity: aisleLink.maxVelocity,
        maxReverseVelocity: aisleLink.maxReverseVelocity,
      },
      {
        srcPointName: '0100',
        destPointName: '0110',
        maxVelocity: 1,
        maxReverseVelocity: 1,
      },
    ],
    locations: [
      { name: 'location_0100', links: [{ pointName: '0100' }] },
      { name: 'location_0110', links: [{ pointName: '0110' }] },
    ],
  };
}

function makeService(model: unknown) {
  const kernelApi = { getPlantModelView: jest.fn().mockResolvedValue(model) };
  return new ZoneGeometryService(kernelApi as never);
}

describe('ZoneGeometryService', () => {
  it('reads the way in from a two-way path drawn as if it led out of the zone', async () => {
    const service = makeService(
      plantModel({
        src: '0100',
        dest: '0082',
        maxVelocity: 1,
        maxReverseVelocity: 1,
      }),
    );

    const axes = await service.computeMemberAxes(ZONE);

    expect(axes).not.toBeNull();
    expect(axes!.get('location_0110')!.depthKey).toBeGreaterThan(
      axes!.get('location_0100')!.depthKey,
    );
  });

  it('reads the way in from a path drawn into the zone', async () => {
    const service = makeService(
      plantModel({
        src: '0082',
        dest: '0100',
        maxVelocity: 1,
        maxReverseVelocity: 0,
      }),
    );

    const axes = await service.computeMemberAxes(ZONE);

    expect(axes!.get('location_0110')!.depthKey).toBeGreaterThan(
      axes!.get('location_0100')!.depthKey,
    );
  });

  it('reads the depth axis off a one-way link no matter which way it runs', async () => {
    const service = makeService(
      plantModel({
        src: '0100',
        dest: '0082',
        maxVelocity: 1,
        maxReverseVelocity: 0,
      }),
    );

    const axes = await service.computeMemberAxes(ZONE);

    expect(axes!.get('location_0110')!.depthKey).toBeGreaterThan(
      axes!.get('location_0100')!.depthKey,
    );
  });

  it('reports no geometry when nothing at all touches the zone', async () => {
    const model = plantModel({
      src: '0100',
      dest: '0110',
      maxVelocity: 1,
      maxReverseVelocity: 1,
    });
    model.points = model.points.filter((p) => p.name !== '0082');

    await expect(
      makeService(model).computeMemberAxes(ZONE),
    ).resolves.toBeNull();
  });
});

const POINT_NAMES = new Map([
  ['location_0100', ['0100']],
  ['location_0110', ['0110']],
]);

function makeIndexingService(model: unknown) {
  const kernelApi = {
    getPlantModelView: jest.fn().mockResolvedValue(model),
    getPointNamesByLocation: jest.fn().mockResolvedValue(POINT_NAMES),
  };
  return { service: new ZoneGeometryService(kernelApi as never), kernelApi };
}

const wayIn = () =>
  plantModel({
    src: '0082',
    dest: '0100',
    maxVelocity: 1,
    maxReverseVelocity: 0,
  });

describe('ZoneGeometryService.laneIndexOf', () => {
  afterEach(() => jest.restoreAllMocks());

  it('collects every point of a lane behind that lane key', async () => {
    const { service } = makeIndexingService(wayIn());

    const index = await service.laneIndexOf(ZONE);

    const laneKey = index!.axesByLocation.get('location_0100')!.laneKey;
    expect([...index!.pointsByLane.get(laneKey)!].sort()).toEqual([
      '0100',
      '0110',
    ]);
  });

  it('reuses the cached index while the members stay the same', async () => {
    const { service, kernelApi } = makeIndexingService(wayIn());

    await service.laneIndexOf(ZONE);
    await service.laneIndexOf(ZONE);

    expect(kernelApi.getPlantModelView).toHaveBeenCalledTimes(1);
  });

  it('reports no index when the geometry cannot be computed', async () => {
    const model = wayIn();
    model.points = model.points.filter((p) => p.name !== '0082');

    await expect(
      makeIndexingService(model).service.laneIndexOf(ZONE),
    ).resolves.toBeNull();
  });

  it('warns when two slots of a lane are not directly connected', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const model = wayIn();
    model.paths = model.paths.filter(
      (path) =>
        !(path.srcPointName === '0100' && path.destPointName === '0110'),
    );

    await makeIndexingService(model).service.laneIndexOf(ZONE);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('without a slot'),
    );
  });

  it('stays quiet when consecutive slots are directly connected', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await makeIndexingService(wayIn()).service.laneIndexOf(ZONE);

    expect(warn).not.toHaveBeenCalled();
  });
});
