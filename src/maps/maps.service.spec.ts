import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MapsService } from './maps.service';
import { MapRecordEntity } from './entities/map-record.entity';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import {
  ZoneEntity,
  ZoneStatus,
  ZoneType,
} from '../zones/entities/zone.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportOrderService } from '../opentcs/transport-order.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { ZoneService } from '../zones/zone.service';

void MapRecordEntity;
void CargoEntity;
void ZoneEntity;

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
  let zoneRepo: RepoMock;
  let kernelApi: {
    getRawPlantModel: jest.Mock;
    getPlantModelName: jest.Mock;
    isReachable: jest.Mock;
    getKernelState: jest.Mock;
    putRawPlantModel: jest.Mock;
    setKernelState: jest.Mock;
    initializeVehiclesForOperation: jest.Mock;
  };
  let zoneService: { sync: jest.Mock };

  beforeEach(async () => {
    mapRepo = makeRepo();
    cargoRepo = makeRepo();
    zoneRepo = makeRepo();
    mapRepo.find.mockResolvedValue([]);
    zoneRepo.find.mockResolvedValue([]);
    kernelApi = {
      getRawPlantModel: jest.fn(),
      getPlantModelName: jest.fn().mockResolvedValue(null),
      isReachable: jest.fn(),
      getKernelState: jest.fn(),
      putRawPlantModel: jest.fn(),
      setKernelState: jest.fn().mockResolvedValue(undefined),
      initializeVehiclesForOperation: jest.fn().mockResolvedValue(undefined),
    };
    zoneService = {
      sync: jest.fn().mockResolvedValue({
        plantModelName: null,
        total: 0,
        markedStale: 0,
        markedActive: 0,
        skippedOtherMaps: 0,
        unassigned: 0,
        kernelUnreachable: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapsService,
        { provide: KernelApiService, useValue: kernelApi },
        {
          provide: TransportOrderService,
          useValue: new TransportOrderService(
            kernelApi as unknown as KernelApiService,
          ),
        },
        { provide: VehicleStateStore, useValue: { get: jest.fn() } },
        { provide: getRepositoryToken(MapRecordEntity), useValue: mapRepo },
        { provide: getRepositoryToken(CargoEntity), useValue: cargoRepo },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        { provide: ZoneService, useValue: zoneService },
      ],
    }).compile();

    service = module.get(MapsService);
  });

  describe('getCurrent', () => {
    it('returns null when kernel has no runtime plant model', async () => {
      kernelApi.getRawPlantModel.mockResolvedValue(null);

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(mapRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns runtime counts from kernel and enriches with latest upload metadata by map name', async () => {
      kernelApi.getRawPlantModel.mockResolvedValue({
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

  describe('map library', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <model name="factory-a">
        <point name="P1" positionX="100" positionY="200" positionZ="0" type="HALT_POSITION" />
        <point name="P2" positionX="300" positionY="200" positionZ="0" type="HALT_POSITION" />
        <path name="P1---P2" sourcePoint="P1" destinationPoint="P2" length="200" maxVelocity="1000" maxReverseVelocity="0" locked="false" />
        <visualLayout name="layout" scaleX="1" scaleY="1" />
      </model>`;

    it('stores XML and preview data without pushing the upload into the kernel', async () => {
      mapRepo.save.mockImplementation(async (entity) => ({
        id: 'map-1',
        uploadedAt: new Date('2026-09-14T00:00:00Z'),
        ...entity,
      }));

      const result = await service.uploadToLibrary(
        Buffer.from(xml),
        'factory-a.xml',
        'user-1',
      );

      expect(result).toMatchObject({
        id: 'map-1',
        name: 'factory-a',
        originalFilename: 'factory-a.xml',
        pointCount: 2,
        pathCount: 1,
        preview: {
          points: [
            expect.objectContaining({ name: 'P1', x: 100, y: 200 }),
            expect.objectContaining({ name: 'P2', x: 300, y: 200 }),
          ],
          paths: [
            expect.objectContaining({
              name: 'P1---P2',
              source: 'P1',
              target: 'P2',
            }),
          ],
        },
      });
      expect(mapRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ xmlContent: xml }),
      );
      expect(kernelApi.putRawPlantModel).not.toHaveBeenCalled();
      expect(kernelApi.setKernelState).not.toHaveBeenCalled();
    });

    it('merges WES zones into the preview of their plant model', async () => {
      mapRepo.find.mockResolvedValue([
        {
          id: 'map-1',
          name: 'factory-a',
          originalFilename: 'factory-a.xml',
          pointCount: 2,
          pathCount: 1,
          vehicleCount: 0,
          locationCount: 0,
          blockCount: 0,
          preview: { points: [], paths: [] },
          uploadedAt: new Date('2026-09-14T00:00:00Z'),
          uploadedById: 'user-1',
          lastLoadedAt: null,
        },
      ]);
      zoneRepo.find.mockResolvedValue([
        {
          id: 'zone-1',
          name: 'Kho nhận',
          type: ZoneType.PICKUP,
          color: '#2563EB',
          plantModelName: 'factory-a',
          status: ZoneStatus.ACTIVE,
          members: [
            { locationName: 'location_P2', positionIndex: 1 },
            { locationName: 'location_P1', positionIndex: 0 },
          ],
        },
      ]);
      kernelApi.getPlantModelName.mockResolvedValue('factory-a');

      await expect(service.listLibrary()).resolves.toEqual([
        expect.objectContaining({
          id: 'map-1',
          active: true,
          areas: [
            {
              id: 'zone-1',
              name: 'Kho nhận',
              kind: 'ZONE',
              status: 'ACTIVE',
              color: '#2563EB',
              pointNames: ['P1', 'P2'],
            },
          ],
        }),
      ]);
    });

    it('shows complete compatible areas when an XML topology was renamed', async () => {
      mapRepo.find.mockResolvedValue([
        {
          id: 'map-renamed',
          name: 'factory-renamed',
          originalFilename: 'factory-renamed.xml',
          pointCount: 2,
          pathCount: 1,
          vehicleCount: 0,
          locationCount: 0,
          blockCount: 0,
          preview: {
            points: [
              { name: 'P1', x: 0, y: 0, type: 'HALT_POSITION' },
              { name: 'P2', x: 1000, y: 0, type: 'HALT_POSITION' },
            ],
            paths: [],
          },
          uploadedAt: new Date('2026-09-14T00:00:00Z'),
          uploadedById: 'user-1',
          lastLoadedAt: null,
        },
      ]);
      zoneRepo.find.mockResolvedValue([
        {
          id: 'compatible',
          name: 'Kho cũ tương thích',
          type: ZoneType.DROPOFF,
          color: '#16A34A',
          plantModelName: 'factory-old-name',
          status: ZoneStatus.ACTIVE,
          members: [
            { locationName: 'location_P1', positionIndex: 0 },
            { locationName: 'location_P2', positionIndex: 1 },
          ],
        },
        {
          id: 'partial',
          name: 'Kho từ topology khác',
          type: ZoneType.DROPOFF,
          color: '#16A34A',
          plantModelName: 'another-factory',
          status: ZoneStatus.ACTIVE,
          members: [
            { locationName: 'location_P1', positionIndex: 0 },
            { locationName: 'location_P9', positionIndex: 1 },
          ],
        },
      ]);
      kernelApi.getPlantModelName.mockResolvedValue(null);

      const result = await service.listLibrary();

      expect(result[0].areas).toEqual([
        expect.objectContaining({
          id: 'compatible',
          kind: 'STORE',
          pointNames: ['P1', 'P2'],
        }),
      ]);
    });

    it('pushes the XML straight to the kernel, re-integrates vehicles, and syncs zones', async () => {
      const record = {
        id: 'map-1',
        name: 'factory-a',
        originalFilename: 'factory-a.xml',
        pointCount: 2,
        pathCount: 1,
        vehicleCount: 0,
        locationCount: 0,
        blockCount: 0,
        xmlContent: xml,
        preview: { points: [], paths: [] },
        uploadedAt: new Date('2026-09-14T00:00:00Z'),
        uploadedById: 'user-1',
        lastLoadedAt: null,
      };
      mapRepo.findOne.mockResolvedValue(record);
      mapRepo.save.mockImplementation(async (entity) => entity);

      await expect(service.loadLibraryMap('map-1')).resolves.toMatchObject({
        id: 'map-1',
        name: 'factory-a',
        active: true,
      });

      expect(mapRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'map-1' } }),
      );
      expect(kernelApi.setKernelState).not.toHaveBeenCalled();
      expect(kernelApi.getKernelState).not.toHaveBeenCalled();
      expect(kernelApi.putRawPlantModel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'factory-a' }),
      );
      expect(kernelApi.initializeVehiclesForOperation).toHaveBeenCalledTimes(1);
      expect(zoneService.sync).toHaveBeenCalledTimes(1);
      expect(record.lastLoadedAt).toBeInstanceOf(Date);
    });

    it('still marks the map as loaded when zone sync itself fails', async () => {
      const record = {
        id: 'map-1',
        name: 'factory-a',
        originalFilename: 'factory-a.xml',
        pointCount: 2,
        pathCount: 1,
        vehicleCount: 0,
        locationCount: 0,
        blockCount: 0,
        xmlContent: xml,
        preview: { points: [], paths: [] },
        uploadedAt: new Date('2026-09-14T00:00:00Z'),
        uploadedById: 'user-1',
        lastLoadedAt: null,
      };
      mapRepo.findOne.mockResolvedValue(record);
      mapRepo.save.mockImplementation(async (entity) => entity);
      zoneService.sync.mockRejectedValue(new Error('kernel busy'));

      await expect(service.loadLibraryMap('map-1')).resolves.toMatchObject({
        id: 'map-1',
        active: true,
      });
      expect(record.lastLoadedAt).toBeInstanceOf(Date);
    });
  });
});
