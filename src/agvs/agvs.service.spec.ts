import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgvsService } from './agvs.service';
import { AgvEntity } from './entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
};

const makeAgv = (overrides: Partial<AgvEntity> = {}): AgvEntity => ({
  id: 'agv-1',
  code: 'AGV-001',
  name: 'AGV 1',
  model: null,
  manufacturer: null,
  serialNumber: null,
  initialPosition: null,
  isDispatchEnabled: true,
  isIgnored: false,
  criticalBatteryThreshold: 20,
  sufficientBatteryThreshold: 10,
  config: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  createdById: 'user-1',
  ...overrides,
});

describe('AgvsService', () => {
  let service: AgvsService;
  let repo: MockRepo;
  let kernelApi: { getVehicles: jest.Mock };
  let vehicleStore: { getAll: jest.Mock; isConnected: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    kernelApi = { getVehicles: jest.fn() };
    // Kernel status is derived from the SSE-backed VehicleStateStore, not a
    // REST call. Default to reachable/empty; individual tests override.
    vehicleStore = {
      getAll: jest.fn().mockReturnValue([]),
      isConnected: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgvsService,
        { provide: getRepositoryToken(AgvEntity), useValue: repo },
        { provide: KernelApiService, useValue: kernelApi },
        { provide: VehicleStateStore, useValue: vehicleStore },
      ],
    }).compile();

    service = module.get(AgvsService);
  });

  describe('list', () => {
    it('paginates results and reports kernel status', async () => {
      const agv = makeAgv();
      repo.findAndCount.mockResolvedValue([[agv], 1]);
      vehicleStore.getAll.mockReturnValue([
        { name: agv.name, integrationLevel: 'TO_BE_UTILIZED' },
      ]);

      const result = await service.list({ page: 1, limit: 10 });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.agvs[0].kernelStatus).toBe('connected');
      expect(result.kernelReachable).toBe(true);
    });

    it('marks kernelStatus as unknown when kernel is unreachable', async () => {
      const agv = makeAgv();
      repo.findAndCount.mockResolvedValue([[agv], 1]);
      vehicleStore.isConnected.mockReturnValue(false);

      const result = await service.list();

      expect(result.kernelReachable).toBe(false);
      expect(result.agvs[0].kernelStatus).toBe('unknown');
    });

    it('marks kernelStatus as reachable when vehicle is not TO_BE_UTILIZED', async () => {
      const agv = makeAgv();
      repo.findAndCount.mockResolvedValue([[agv], 1]);
      vehicleStore.getAll.mockReturnValue([
        { name: agv.name, integrationLevel: 'TO_BE_IGNORED' },
      ]);

      const result = await service.list();

      expect(result.agvs[0].kernelStatus).toBe('reachable');
    });

    it('marks kernelStatus as unreachable when name does not match any kernel vehicle', async () => {
      const agv = makeAgv();
      repo.findAndCount.mockResolvedValue([[agv], 1]);
      vehicleStore.getAll.mockReturnValue([
        { name: 'OTHER-AGV', integrationLevel: 'TO_BE_UTILIZED' },
      ]);

      const result = await service.list();

      expect(result.agvs[0].kernelStatus).toBe('unreachable');
    });

    it('applies search filter across code and name', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.list({ search: 'agv-1' });

      const callArg: { where?: unknown[] } = repo.findAndCount.mock.calls[0][0];
      expect(callArg.where).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('returns the AGV with kernel status when found', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);

      const result = await service.findOne(agv.id);

      expect(result.id).toBe(agv.id);
      expect(result.kernelStatus).toBe('unreachable');
    });

    it('throws NotFoundException when AGV does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates allowed fields and persists changes', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);
      repo.save.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.update(agv.id, {
        name: 'AGV 1 Renamed',
        criticalBatteryThreshold: 30,
        sufficientBatteryThreshold: 15,
      });

      expect(repo.save).toHaveBeenCalled();
      expect(result.name).toBe('AGV 1 Renamed');
      expect(result.criticalBatteryThreshold).toBe(30);
      expect(result.sufficientBatteryThreshold).toBe(15);
    });

    it('throws NotFoundException when AGV does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when renaming to an existing name', async () => {
      const agv = makeAgv({ id: 'agv-1', name: 'AGV 1' });
      const other = makeAgv({ id: 'agv-2', name: 'AGV 2' });
      repo.findOne.mockResolvedValueOnce(agv).mockResolvedValueOnce(other);

      await expect(service.update('agv-1', { name: 'AGV 2' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows keeping the same name without conflict', async () => {
      const agv = makeAgv({ id: 'agv-1', name: 'AGV 1' });
      repo.findOne.mockResolvedValueOnce(agv);
      repo.save.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.update('agv-1', { name: 'AGV 1' });

      expect(result.name).toBe('AGV 1');
    });
  });

  describe('create', () => {
    it('throws ConflictException when code already exists', async () => {
      repo.findOne.mockResolvedValueOnce(makeAgv());

      await expect(
        service.create({ code: 'AGV-001', name: 'New AGV' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when AGV does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the AGV when found', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);

      await service.remove(agv.id);

      expect(repo.remove).toHaveBeenCalledWith(agv);
    });
  });
});
