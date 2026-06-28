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
  let kernelApi: { getPlantModel: jest.Mock };

  beforeEach(async () => {
    zoneRepo = makeRepo();
    memberRepo = makeRepo();
    kernelApi = {
      getPlantModel: jest.fn(),
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

  it('marks zone ACTIVE when member locations and approach location match runtime plant model', async () => {
    const zone = makeZone({
      status: ZoneStatus.STALE,
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

    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.ACTIVE }),
    );
    expect(result).toEqual({
      total: 1,
      markedStale: 0,
      markedActive: 1,
      kernelUnreachable: false,
    });
  });

  it('marks zone STALE when a member location is missing from runtime plant model', async () => {
    const zone = makeZone({
      members: [makeMember('location_P1', 0), makeMember('location_P2', 1)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({
        pointNames: ['P1', 'P2'],
        locations: [
          { name: 'location_P1', links: ['P1'] },
          { name: 'zone_1', links: ['P1', 'P2'] },
        ],
      }),
    );

    const result = await service.sync();

    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.STALE }),
    );
    expect(result.markedStale).toBe(1);
  });

  it('marks zone STALE when member location link no longer points to an existing point', async () => {
    const zone = makeZone({
      members: [makeMember('location_P1', 0)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({
        pointNames: [],
        locations: [
          { name: 'location_P1', links: ['P1'] },
          { name: 'zone_1', links: ['P1'] },
        ],
      }),
    );

    const result = await service.sync();

    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.STALE }),
    );
    expect(result.markedStale).toBe(1);
  });

  it('marks dropoff zone STALE when approach location links drift away from member points', async () => {
    const zone = makeZone({
      members: [makeMember('location_P1', 0)],
    });
    zoneRepo.find.mockResolvedValue([zone]);
    kernelApi.getPlantModel.mockResolvedValue(
      makePlantModel({
        pointNames: ['P1', 'P9'],
        locations: [
          { name: 'location_P1', links: ['P1'] },
          { name: 'zone_1', links: ['P9'] },
        ],
      }),
    );

    const result = await service.sync();

    expect(zoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ZoneStatus.STALE }),
    );
    expect(result.markedStale).toBe(1);
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
