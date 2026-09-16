import { OperatingCargoService } from './operating-cargo.service';
import type { CargoService } from '../../cargo/cargo.service';
import { CargoStatus } from '../../cargo/entities/cargo.entity';

function storedCargo() {
  return {
    id: 'cargo-1',
    itemCode: 'BOX-1',
    status: CargoStatus.ACTIVE,
    taskStatus: null,
    assignedVehicleName: null,
    sourceZoneId: 'zone-src',
    sourcePointName: 'P1',
    sourcePickupLocationName: 'LOC-1',
    destinationZoneId: 'zone-dst',
    destinationLocationName: null,
    blockedReason: null,
    visual: { state: 'AT_SOURCE', pointName: null },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  } as unknown as Awaited<ReturnType<CargoService['findOne']>>;
}

function makeService(activeMapRecordId: string | null) {
  const cargo = {
    list: jest.fn().mockResolvedValue({ cargos: [], total: 0, truncated: false }),
    create: jest.fn().mockResolvedValue({ id: 'cargo-1' }),
    findOne: jest.fn().mockResolvedValue(storedCargo()),
    remove: jest.fn().mockResolvedValue({ message: 'Cargo deleted.' }),
  };
  const activeMapRecords = {
    resolveId: jest.fn().mockResolvedValue(activeMapRecordId),
  };
  const service = new OperatingCargoService(
    cargo as unknown as CargoService,
    activeMapRecords as never,
  );
  return { service, cargo };
}

const FORBIDDEN =
  'Vai trò của bạn không được gán quyền thao tác trên bản đồ đang tải.';

describe('OperatingCargoService AUTH-3 map scope', () => {
  describe('list', () => {
    it("returns an empty page (not a throw) when the active map falls outside the caller's scope", async () => {
      const { service } = makeService('map-a');
      await expect(service.list(['map-b'])).resolves.toEqual({
        cargos: [],
        total: 0,
        truncated: false,
      });
    });

    it('returns an empty page when no map is active at all and the caller is scoped', async () => {
      const { service } = makeService(null);
      await expect(service.list(['map-b'])).resolves.toEqual({
        cargos: [],
        total: 0,
        truncated: false,
      });
    });

    it('proceeds normally when the active map is within scope', async () => {
      const { service, cargo } = makeService('map-a');
      await service.list(['map-a', 'map-b']);
      expect(cargo.list).toHaveBeenCalled();
    });

    it('is unaffected when mapIds is undefined (unrestricted — regression guard)', async () => {
      const { service, cargo } = makeService(null);
      await service.list(undefined);
      expect(cargo.list).toHaveBeenCalled();
    });
  });

  describe('mutating methods throw Forbidden when the active map is out of scope', () => {
    it('create', async () => {
      const { service } = makeService('map-a');
      await expect(
        service.create(
          {
            pickupAreaWesId: 'zone-src',
            pickupPointName: 'P1',
            targetStoreAreaWesId: 'zone-dst',
          },
          'user-1',
          ['map-b'],
        ),
      ).rejects.toThrow(FORBIDDEN);
    });

    it('cancel', async () => {
      const { service } = makeService('map-a');
      await expect(service.cancel('cargo-1', ['map-b'])).rejects.toThrow(
        FORBIDDEN,
      );
    });
  });

  describe('mutating methods proceed when the active map is in scope, or the caller is unrestricted', () => {
    it('create — in scope', async () => {
      const { service, cargo } = makeService('map-a');
      await service.create(
        {
          pickupAreaWesId: 'zone-src',
          pickupPointName: 'P1',
          targetStoreAreaWesId: 'zone-dst',
        },
        'user-1',
        ['map-a'],
      );
      expect(cargo.create).toHaveBeenCalled();
    });

    it('create — unrestricted (mapIds undefined)', async () => {
      const { service, cargo } = makeService('map-a');
      await service.create(
        {
          pickupAreaWesId: 'zone-src',
          pickupPointName: 'P1',
          targetStoreAreaWesId: 'zone-dst',
        },
        'user-1',
        undefined,
      );
      expect(cargo.create).toHaveBeenCalled();
    });

    it('cancel — in scope', async () => {
      const { service, cargo } = makeService('map-a');
      await service.cancel('cargo-1', ['map-a']);
      expect(cargo.remove).toHaveBeenCalledWith('cargo-1');
    });
  });
});
