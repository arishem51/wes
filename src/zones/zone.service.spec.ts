import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ZoneService } from './zone.service';
import { ZoneEntity, ZoneStatus, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

const makeZone = (overrides: Partial<ZoneEntity> = {}): ZoneEntity => ({
  id: 'zone-1',
  name: 'Dropoff A',
  type: ZoneType.DROPOFF,
  color: '#2563eb',
  kernelId: 1,
  approachLocationName: 'zone_1',
  status: ZoneStatus.ACTIVE,
  members: [],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const makeMember = (
  locationName: string,
  positionIndex: number,
): ZoneMemberEntity => ({
  id: `member-${positionIndex}`,
  zoneId: 'zone-1',
  zone: {} as ZoneEntity,
  locationName,
  positionIndex,
  createdAt: new Date('2026-01-01'),
});

const makePlantModel = ({
  pointNames,
  locations,
}: {
  pointNames: string[];
  locations: Array<{ name: string; links: string[] }>;
}) => ({
  name: 'runtime-map',
  points: pointNames.map((name) => ({
    name,
    position: { x: 0, y: 0, z: 0 },
  })),
  locations: locations.map((location) => ({
    name: location.name,
    links: location.links.map((pointName) => ({ pointName })),
  })),
});

type RepoMock = {
  find: jest.Mock;
  save: jest.Mock;
};

function makeRepo(): RepoMock {
  return {
    find: jest.fn(),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  };
}

describe('ZoneService.sync', () => {
  let service: ZoneService;
  let zoneRepo: RepoMock;
  let memberRepo: RepoMock;
  let kernelApi: {
    getPlantModel: jest.Mock;
    invalidatePlantModelCache: jest.Mock;
    putRawPlantModel: jest.Mock;
  };

  beforeEach(async () => {
    zoneRepo = makeRepo();
    memberRepo = makeRepo();
    kernelApi = {
      getPlantModel: jest.fn(),
      invalidatePlantModelCache: jest.fn(),
      // Default: kernel accepts the write (MODELLING). OPERATING cases override
      // this with a rejection.
      putRawPlantModel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneService,
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn() },
        },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        { provide: getRepositoryToken(ZoneMemberEntity), useValue: memberRepo },
        { provide: KernelApiService, useValue: kernelApi },
      ],
    }).compile();

    service = module.get(ZoneService);
  });

  const makePickupZone = (
    id: string,
    name: string,
    status: ZoneStatus,
    locationNames: string[],
  ): ZoneEntity =>
    makeZone({
      id,
      name,
      type: ZoneType.PICKUP,
      kernelId: null,
      approachLocationName: null,
      status,
      members: locationNames.map((locationName, index) =>
        makeMember(locationName, index),
      ),
    });

  it('leaves an already-valid ACTIVE zone ACTIVE and writes nothing', async () => {
    const zone = makeZone({
      status: ZoneStatus.ACTIVE,
      members: [makeMember('location_P1', 0), makeMember('location_P2', 1)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({
        pointNames: ['P1', 'P2'],
        locations: [
          { name: 'location_P1', links: ['P1'] },
          { name: 'location_P2', links: ['P2'] },
          { name: 'zone_1', links: ['P1', 'P2'] },
        ],
      }),
    );

    const result = await service.sync();

    expect(result).toEqual({
      total: 1,
      markedStale: 0,
      markedActive: 0,
      kernelUnreachable: false,
    });
    expect(zoneRepo.save).not.toHaveBeenCalled();
    expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
  });

  it('rebuilds a repairable ACTIVE zone in the kernel while keeping it ACTIVE', async () => {
    const zone = makeZone({
      status: ZoneStatus.ACTIVE,
      members: [makeMember('location_P1', 0), makeMember('location_P2', 1)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    // Points still exist but every location is gone (map reloaded without them).
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: ['P1', 'P2'], locations: [] }),
    );

    const result = await service.sync();

    expect(result.markedStale).toBe(0);
    expect(kernelApi.putRawPlantModel).toHaveBeenCalledTimes(1);
    const pushed = kernelApi.putRawPlantModel.mock.calls[0][0] as {
      locations: Array<{ name: string }>;
    };
    expect(pushed.locations.map((location) => location.name).sort()).toEqual([
      'location_P1',
      'location_P2',
      'zone_1',
    ]);
  });

  it('does not resurrect a STALE zone even if its points still exist', async () => {
    const zone = makeZone({
      status: ZoneStatus.STALE,
      members: [makeMember('location_P1', 0)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: ['P1'], locations: [] }),
    );

    const result = await service.sync();

    expect(result).toEqual({
      total: 1,
      markedStale: 0,
      markedActive: 0,
      kernelUnreachable: false,
    });
    expect(zoneRepo.save).not.toHaveBeenCalled();
    expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
  });

  it('keeps the sole ACTIVE zone and leaves a conflicting STALE zone STALE', async () => {
    const active = makePickupZone('z1', 'zone A', ZoneStatus.ACTIVE, [
      'location_P1',
    ]);
    const stale = makePickupZone('z2', 'Lấy hànng', ZoneStatus.STALE, [
      'location_P1',
    ]);
    zoneRepo.find.mockResolvedValue([active, stale]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: ['P1'], locations: [] }),
    );

    const result = await service.sync();

    expect(result.markedStale).toBe(0);
    // Only the winning (ACTIVE) zone's location is pushed to the kernel.
    expect(kernelApi.putRawPlantModel).toHaveBeenCalledTimes(1);
    const pushed = kernelApi.putRawPlantModel.mock.calls[0][0] as {
      locations: Array<{ name: string }>;
    };
    expect(pushed.locations.map((location) => location.name)).toEqual([
      'location_P1',
    ]);
  });

  it('marks both zones STALE when two ACTIVE zones share a location', async () => {
    const a = makePickupZone('z1', 'zone A', ZoneStatus.ACTIVE, [
      'location_P1',
    ]);
    const b = makePickupZone('z2', 'Lấy hànng', ZoneStatus.ACTIVE, [
      'location_P1',
    ]);
    zoneRepo.find.mockResolvedValue([a, b]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: ['P1'], locations: [] }),
    );

    const result = await service.sync();

    expect(result.markedStale).toBe(2);
    expect(result.markedActive).toBe(0);
    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'z1', status: ZoneStatus.STALE }),
    );
    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'z2', status: ZoneStatus.STALE }),
    );
    expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
  });

  it('falls back to STALE when the kernel rejects the repair write (read-only / OPERATING)', async () => {
    const zone = makeZone({
      status: ZoneStatus.ACTIVE,
      members: [makeMember('location_P1', 0), makeMember('location_P2', 1)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: ['P1', 'P2'], locations: [] }),
    );
    kernelApi.putRawPlantModel.mockRejectedValue(new Error('OPERATING'));

    const result = await service.sync();

    expect(result.markedStale).toBe(1);
    expect(result.markedActive).toBe(0);
    expect(kernelApi.putRawPlantModel).toHaveBeenCalledTimes(1);
    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.STALE }),
    );
  });

  it('marks an ACTIVE zone STALE without writing when a member point is missing', async () => {
    const zone = makeZone({
      status: ZoneStatus.ACTIVE,
      members: [makeMember('location_P1', 0)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({ pointNames: [], locations: [] }),
    );

    const result = await service.sync();

    expect(result.markedStale).toBe(1);
    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.STALE }),
    );
    expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
  });

  it('returns kernelUnreachable=true and skips sync when plant model is unavailable', async () => {
    kernelApi.getPlantModel.mockResolvedValue(null);

    const result = await service.sync();

    expect(result).toEqual({
      total: 0,
      markedStale: 0,
      markedActive: 0,
      kernelUnreachable: true,
    });
    expect(zoneRepo.find).not.toHaveBeenCalled();
    expect(zoneRepo.save).not.toHaveBeenCalled();
  });
});
