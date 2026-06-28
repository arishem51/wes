import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MapsService } from './maps.service';
import { MapRecordEntity } from './entities/map-record.entity';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

void MapRecordEntity;
void CargoEntity;

type RepoMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function makeRepo(): RepoMock {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => entity),
  };
}

describe('MapsService', () => {
  let service: MapsService;
  let mapRepo: RepoMock;
  let cargoRepo: RepoMock;
  let kernelApi: {
    getPlantModel: jest.Mock;
    isReachable: jest.Mock;
    getKernelState: jest.Mock;
    putRawPlantModel: jest.Mock;
  };

  beforeEach(async () => {
    mapRepo = makeRepo();
    cargoRepo = makeRepo();
    kernelApi = {
      getPlantModel: jest.fn(),
      isReachable: jest.fn(),
      getKernelState: jest.fn(),
      putRawPlantModel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapsService,
        { provide: KernelApiService, useValue: kernelApi },
        { provide: getRepositoryToken(MapRecordEntity), useValue: mapRepo },
        { provide: getRepositoryToken(CargoEntity), useValue: cargoRepo },
      ],
    }).compile();

    service = module.get(MapsService);
  });

  describe('getCurrent', () => {
    it('returns null when kernel has no runtime plant model', async () => {
      kernelApi.getPlantModel.mockResolvedValue(null);

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(mapRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns runtime counts from kernel and enriches with latest upload metadata by map name', async () => {
      kernelApi.getPlantModel.mockResolvedValue({
        name: 'v7',
        points: [{ name: 'P1' }, { name: 'P2' }],
        paths: [{ name: 'path-1' }],
        vehicles: [{ name: 'AGV-01' }, { name: 'AGV-02' }],
      });
      mapRepo.findOne.mockResolvedValue({
        id: 'map-1',
        name: 'v7',
        originalFilename: 'v7.xml',
        pointCount: 504,
        pathCount: 703,
        vehicleCount: 10,
        uploadedAt: new Date('2026-06-25T12:12:00.000Z'),
        uploadedById: 'user-1',
      });

      await expect(service.getCurrent()).resolves.toEqual({
        name: 'v7',
        pointCount: 2,
        pathCount: 1,
        vehicleCount: 2,
        originalFilename: 'v7.xml',
        uploadedAt: new Date('2026-06-25T12:12:00.000Z'),
        uploadedById: 'user-1',
      });
      expect(mapRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'v7' },
        order: { uploadedAt: 'DESC' },
      });
    });
  });
});
