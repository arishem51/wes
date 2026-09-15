import { OperatingAreasService } from './operating-areas.service';
import type { ZoneService } from '../../zones/zone.service';
import type { KernelApiService } from '../../opentcs/kernel-api.service';

function makeService(activeMapRecordId: string | null) {
  const zones = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'zone-1' }),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    sync: jest.fn().mockResolvedValue({
      plantModelName: 'factory-a',
      total: 0,
      markedStale: 0,
      markedActive: 0,
      skippedOtherMaps: 0,
      unassigned: 0,
      kernelUnreachable: false,
    }),
    activeMapRecordId: jest.fn().mockResolvedValue(activeMapRecordId),
  };
  const cargoRepo = { count: jest.fn().mockResolvedValue(0) };
  const taskRepo = { find: jest.fn().mockResolvedValue([]) };
  const service = new OperatingAreasService(
    zones as unknown as ZoneService,
    {} as KernelApiService,
    cargoRepo as never,
    taskRepo as never,
  );
  return { service, zones };
}

const FORBIDDEN =
  'Vai trò của bạn không được gán quyền thao tác trên bản đồ đang tải.';

describe('OperatingAreasService AUTH-3 map scope', () => {
  it('rejects an Area from another map before updating or deleting it', async () => {
    const { service, zones } = makeService('map-a');
    await expect(
      service.update('zone-b', { color: '#ff0000' }, ['map-a']),
    ).rejects.toThrow();
    await expect(service.remove('zone-b', ['map-a'])).rejects.toThrow();
    expect(zones.update).not.toHaveBeenCalled();
    expect(zones.remove).not.toHaveBeenCalled();
  });
  describe('list', () => {
    it("returns [] (not a throw) when the active map falls outside the caller's scope", async () => {
      const { service } = makeService('map-a');
      await expect(service.list(['map-b'])).resolves.toEqual([]);
    });

    it('returns [] when no map is active at all and the caller is scoped', async () => {
      const { service } = makeService(null);
      await expect(service.list(['map-b'])).resolves.toEqual([]);
    });

    it('proceeds normally when the active map is within scope', async () => {
      const { service, zones } = makeService('map-a');
      await service.list(['map-a', 'map-b']);
      expect(zones.list).toHaveBeenCalled();
    });

    it('is unaffected when mapIds is undefined (unrestricted — regression guard)', async () => {
      const { service, zones } = makeService(null);
      await service.list(undefined);
      expect(zones.list).toHaveBeenCalled();
    });
  });

  describe('mutating methods throw Forbidden when the active map is out of scope', () => {
    it('create', async () => {
      const { service } = makeService('map-a');
      await expect(
        service.create({ name: 'Kho A', kind: 'ZONE', members: [] }, ['map-b']),
      ).rejects.toThrow(FORBIDDEN);
    });

    it('update', async () => {
      const { service } = makeService('map-a');
      await expect(service.update('zone-1', {}, ['map-b'])).rejects.toThrow(
        FORBIDDEN,
      );
    });

    it('remove', async () => {
      const { service } = makeService('map-a');
      await expect(service.remove('zone-1', ['map-b'])).rejects.toThrow(
        FORBIDDEN,
      );
    });

    it('sync', async () => {
      const { service } = makeService('map-a');
      await expect(service.sync(['map-b'])).rejects.toThrow(FORBIDDEN);
    });

    it('replaceMembers', async () => {
      const { service } = makeService('map-a');
      await expect(
        service.replaceMembers('zone-1', { members: [] }, ['map-b']),
      ).rejects.toThrow(FORBIDDEN);
    });
  });

  describe('mutating methods proceed when the active map is in scope, or the caller is unrestricted', () => {
    it('sync — in scope', async () => {
      const { service, zones } = makeService('map-a');
      await service.sync(['map-a']);
      expect(zones.sync).toHaveBeenCalled();
    });

    it('sync — unrestricted (mapIds undefined)', async () => {
      const { service, zones } = makeService('map-a');
      await service.sync(undefined);
      expect(zones.sync).toHaveBeenCalled();
    });
  });
});

describe('OperatingAreasService.update — name and color', () => {
  const zoneFixture = {
    id: 'zone-1',
    name: 'Old name',
    type: 'PICKUP',
    color: '#111111',
    plantModelName: 'factory-a',
    status: 'ACTIVE',
    members: [],
  };

  function makeUpdateService() {
    const zones = {
      list: jest.fn().mockResolvedValue([zoneFixture]),
      create: jest.fn().mockResolvedValue({ id: 'zone-1' }),
      update: jest.fn().mockResolvedValue(undefined),
      activeMapRecordId: jest.fn().mockResolvedValue('map-a'),
    };
    const cargoRepo = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) };
    const taskRepo = { find: jest.fn().mockResolvedValue([]) };
    const service = new OperatingAreasService(
      zones as unknown as ZoneService,
      { loadOperation: 'load', unloadOperation: 'unload' } as KernelApiService,
      cargoRepo as never,
      taskRepo as never,
    );
    return { service, zones };
  }

  it('passes name through to ZoneService.update when provided', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', { name: 'Kho mới' });
    expect(zones.update).toHaveBeenCalledWith(
      'zone-1',
      expect.objectContaining({ name: 'Kho mới' }),
      undefined,
    );
  });

  it('trims a whitespace-padded name before passing it through', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', { name: '  Kho mới  ' });
    expect(zones.update).toHaveBeenCalledWith(
      'zone-1',
      expect.objectContaining({ name: 'Kho mới' }),
      undefined,
    );
  });

  it('does not call ZoneService.update at all when neither name nor a valid color is given', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', {});
    expect(zones.update).not.toHaveBeenCalled();
  });

  it('still updates color alone, unaffected by the name addition', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', { color: '#abcdef' });
    expect(zones.update).toHaveBeenCalledWith(
      'zone-1',
      { color: '#abcdef' },
      undefined,
    );
  });

  it('passes operation through to ZoneService.update when provided', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', { operation: 'Charge' });
    expect(zones.update).toHaveBeenCalledWith(
      'zone-1',
      { operation: 'Charge' },
      undefined,
    );
  });

  it('passes maxVehicles through, including an explicit null to clear it', async () => {
    const { service, zones } = makeUpdateService();
    await service.update('zone-1', { maxVehicles: null });
    expect(zones.update).toHaveBeenCalledWith(
      'zone-1',
      { maxVehicles: null },
      undefined,
    );
  });

  it('creates an Area with operation and maxVehicles when provided', async () => {
    const { service, zones } = makeUpdateService();
    await service.create({
      name: 'Kho A',
      kind: 'ZONE',
      operation: 'Charge',
      maxVehicles: 3,
      members: [],
    });
    expect(zones.create).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'Charge', maxVehicles: 3 }),
      undefined,
    );
  });
});
