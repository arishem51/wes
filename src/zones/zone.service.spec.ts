import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ZoneService } from './zone.service';
import { ZoneEntity, ZoneStatus, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { CreateZoneDto } from './zone.dto';

// ─── helpers ────────────────────────────────────────────────────────────────

const makeZone = (overrides: Partial<ZoneEntity> = {}): ZoneEntity => ({
  id: 'zone-1',
  name: 'Khu trả hàng A',
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

const baseDropoffDto = (): CreateZoneDto => ({
  name: 'Khu trả hàng A',
  type: ZoneType.DROPOFF,
  members: [
    { locationName: 'LOC-D1', positionIndex: 0 },
    { locationName: 'LOC-D2', positionIndex: 1 },
  ],
});

const basePickupDto = (): CreateZoneDto => ({
  name: 'Khu lấy hàng B',
  type: ZoneType.PICKUP,
  members: [
    { locationName: 'LOC-P1', positionIndex: 0 },
    { locationName: 'LOC-P2', positionIndex: 1 },
  ],
});

const makeKernelModel = () => ({
  name: 'test-model',
  points: [
    { name: 'LOC-D1', position: { x: 100, y: 200, z: 0 } },
    { name: 'LOC-D2', position: { x: 300, y: 400, z: 0 } },
  ],
  locations: [
    {
      name: 'existing-loc',
      typeName: 'Drop off',
      position: { x: 100, y: 200, z: 0 },
      locked: false,
      links: [{ pointName: 'P0' }],
    },
  ],
});

// ─── mocks ──────────────────────────────────────────────────────────────────

type MockRepo = {
  create: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
  findOneOrFail: jest.Mock;
};

function makeRepo(): MockRepo {
  return {
    create: jest.fn((data: unknown) => ({ ...(data as object) })),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    find: jest.fn(),
    findOneOrFail: jest.fn(),
  };
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('ZoneService', () => {
  let service: ZoneService;
  let zoneRepo: MockRepo;
  let memberRepo: MockRepo;
  let dataSource: { query: jest.Mock };
  let kernelApi: {
    getLocationModel: jest.Mock;
    getKernelState: jest.Mock;
    getPlantModel: jest.Mock;
    putRawPlantModel: jest.Mock;
  };

  beforeEach(async () => {
    zoneRepo = makeRepo();
    memberRepo = makeRepo();
    // Simulate nextval returning kernelId = 1
    dataSource = { query: jest.fn().mockResolvedValue([{ id: '1' }]) };
    kernelApi = {
      getLocationModel: jest.fn(),
      getKernelState: jest.fn().mockResolvedValue('MODELLING'),
      getPlantModel: jest.fn().mockResolvedValue(makeKernelModel()),
      putRawPlantModel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        { provide: getRepositoryToken(ZoneMemberEntity), useValue: memberRepo },
        { provide: KernelApiService, useValue: kernelApi },
      ],
    }).compile();

    service = module.get(ZoneService);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('generates kernel_id and sets approachLocationName to zone_{kernelId}', async () => {
      const saved = makeZone({ id: 'zone-new' });
      zoneRepo.save.mockResolvedValue(saved);
      memberRepo.save.mockResolvedValue([]);
      zoneRepo.findOneOrFail.mockResolvedValue({
        ...saved,
        members: [makeMember('LOC-D1', 0), makeMember('LOC-D2', 1)],
      });

      const result = await service.create(baseDropoffDto());

      expect(dataSource.query).toHaveBeenCalledWith(
        `SELECT nextval('zone_kernel_id_seq') AS id`,
      );
      expect(zoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZoneType.DROPOFF,
          kernelId: 1,
          approachLocationName: 'zone_1',
          status: ZoneStatus.ACTIVE,
        }),
      );
      // member locationNames are stored as-is from the DTO
      expect(memberRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ locationName: 'LOC-D1', positionIndex: 0 }),
          expect.objectContaining({ locationName: 'LOC-D2', positionIndex: 1 }),
        ]),
      );
      expect(result.members).toHaveLength(2);
    });

    it('applies DROPOFF zone location to kernel with zone_{kernelId} as parent name', async () => {
      const saved = makeZone({ id: 'zone-new' });
      zoneRepo.save.mockResolvedValue(saved);
      memberRepo.save.mockResolvedValue([]);
      zoneRepo.findOneOrFail.mockResolvedValue({ ...saved, members: [] });

      await service.create(baseDropoffDto());

      // Parent location uses zone_{kernelId}; child locations use original member names
      expect(kernelApi.putRawPlantModel).toHaveBeenCalledWith(
        expect.objectContaining({
          locations: expect.arrayContaining([
            expect.objectContaining({
              name: 'zone_1',
              links: expect.arrayContaining([
                expect.objectContaining({ pointName: 'LOC-D1' }),
                expect.objectContaining({ pointName: 'LOC-D2' }),
              ]),
            }),
            expect.objectContaining({ name: 'LOC-D1' }),
            expect.objectContaining({ name: 'LOC-D2' }),
          ]),
        }),
      );
    });

    it('throws when kernel is not in MODELLING mode for DROPOFF zone', async () => {
      kernelApi.getKernelState.mockResolvedValue('OPERATING');

      await expect(service.create(baseDropoffDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a PICKUP zone without approach location and without kernel patch', async () => {
      const saved = makeZone({
        id: 'zone-p',
        type: ZoneType.PICKUP,
        approachLocationName: null,
      });
      zoneRepo.save.mockResolvedValue(saved);
      memberRepo.save.mockResolvedValue([]);
      zoneRepo.findOneOrFail.mockResolvedValue({ ...saved, members: [] });

      await service.create(basePickupDto());

      expect(zoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZoneType.PICKUP,
          approachLocationName: null,
        }),
      );
      expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when duplicate locationName in members', async () => {
      const dto: CreateZoneDto = {
        ...baseDropoffDto(),
        members: [
          { locationName: 'LOC-D1', positionIndex: 0 },
          { locationName: 'LOC-D1', positionIndex: 1 },
        ],
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(
        'Duplicate locationName',
      );
    });

    it('throws BadRequestException when duplicate positionIndex in members', async () => {
      const dto: CreateZoneDto = {
        ...baseDropoffDto(),
        members: [
          { locationName: 'LOC-D1', positionIndex: 0 },
          { locationName: 'LOC-D2', positionIndex: 0 },
        ],
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(
        'Duplicate positionIndex',
      );
    });
  });

  // ── sync ──────────────────────────────────────────────────────────────────

  describe('sync', () => {
    it('marks zone ACTIVE when all member locations and approach location exist in kernel', async () => {
      const zone = makeZone({
        status: ZoneStatus.STALE,
        approachLocationName: 'zone_1',
        members: [makeMember('LOC-D1', 0), makeMember('LOC-D2', 1)],
      });
      zoneRepo.find.mockResolvedValue([zone]);
      kernelApi.getLocationModel.mockResolvedValue({
        locations: [{ name: 'zone_1' }, { name: 'LOC-D1' }, { name: 'LOC-D2' }],
        locationTypes: [],
      });

      const result = await service.sync();

      expect(zoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ZoneStatus.ACTIVE }),
      );
      expect(result.markedActive).toBe(1);
      expect(result.markedStale).toBe(0);
    });

    it('marks zone STALE when a member location is missing from kernel', async () => {
      const zone = makeZone({
        status: ZoneStatus.ACTIVE,
        approachLocationName: 'zone_1',
        members: [makeMember('LOC-D1', 0), makeMember('LOC-D2', 1)],
      });
      zoneRepo.find.mockResolvedValue([zone]);
      kernelApi.getLocationModel.mockResolvedValue({
        locations: [{ name: 'zone_1' }, { name: 'LOC-D1' }], // LOC-D2 missing
        locationTypes: [],
      });

      const result = await service.sync();

      expect(zoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ZoneStatus.STALE }),
      );
      expect(result.markedStale).toBe(1);
    });

    it('marks DROPOFF zone STALE when approachLocationName missing from kernel', async () => {
      const zone = makeZone({
        status: ZoneStatus.ACTIVE,
        type: ZoneType.DROPOFF,
        approachLocationName: 'zone_1',
        members: [makeMember('LOC-D1', 0)],
      });
      zoneRepo.find.mockResolvedValue([zone]);
      kernelApi.getLocationModel.mockResolvedValue({
        locations: [{ name: 'LOC-D1' }], // approach location missing
        locationTypes: [],
      });

      const result = await service.sync();

      expect(zoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ZoneStatus.STALE }),
      );
      expect(result.markedStale).toBe(1);
    });

    it('does not save zone when status is already correct', async () => {
      const zone = makeZone({
        status: ZoneStatus.ACTIVE,
        approachLocationName: 'zone_1',
        members: [makeMember('LOC-D1', 0)],
      });
      zoneRepo.find.mockResolvedValue([zone]);
      kernelApi.getLocationModel.mockResolvedValue({
        locations: [{ name: 'zone_1' }, { name: 'LOC-D1' }],
        locationTypes: [],
      });

      await service.sync();

      expect(zoneRepo.save).not.toHaveBeenCalled();
    });

    it('returns kernelUnreachable=true and skips sync when kernel is down', async () => {
      kernelApi.getLocationModel.mockResolvedValue(null);

      const result = await service.sync();

      expect(result.kernelUnreachable).toBe(true);
      expect(result.total).toBe(0);
      expect(zoneRepo.find).not.toHaveBeenCalled();
      expect(zoneRepo.save).not.toHaveBeenCalled();
    });

    it('handles multiple zones independently', async () => {
      const validZone = makeZone({
        id: 'zone-1',
        status: ZoneStatus.ACTIVE,
        approachLocationName: 'zone_1',
        members: [makeMember('LOC-D1', 0)],
      });
      const staleZone = makeZone({
        id: 'zone-2',
        name: 'Khu trả hàng B',
        kernelId: 2,
        status: ZoneStatus.ACTIVE,
        approachLocationName: 'zone_2',
        members: [makeMember('LOC-D3', 0)],
      });
      zoneRepo.find.mockResolvedValue([validZone, staleZone]);
      kernelApi.getLocationModel.mockResolvedValue({
        locations: [{ name: 'zone_1' }, { name: 'LOC-D1' }], // zone B missing
        locationTypes: [],
      });

      const result = await service.sync();

      expect(result.markedStale).toBe(1);
      expect(result.markedActive).toBe(0);
      expect(result.total).toBe(2);
    });
  });
});
