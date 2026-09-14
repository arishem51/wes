import { OperatingCommandsService } from './operating-commands.service';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';

function vehicle(overrides: Partial<KernelVehicleState> = {}): KernelVehicleState {
  return {
    name: 'V1',
    state: 'IDLE',
    procState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    energyLevel: 90,
    paused: false,
    currentPosition: null,
    transportOrder: null,
    ...overrides,
  };
}

describe('OperatingCommandsService', () => {
  let kernelApi: jest.Mocked<
    Pick<
      KernelApiService,
      | 'setVehicleAdapterEnabled'
      | 'setVehicleIntegrationLevel'
      | 'withdrawVehicleOrder'
      | 'getVehicles'
      | 'setVehiclePaused'
    >
  >;
  let store: VehicleStateStore;
  let service: OperatingCommandsService;

  beforeEach(() => {
    kernelApi = {
      setVehicleAdapterEnabled: jest.fn().mockResolvedValue(undefined),
      setVehicleIntegrationLevel: jest.fn().mockResolvedValue(undefined),
      withdrawVehicleOrder: jest.fn().mockResolvedValue(undefined),
      getVehicles: jest.fn().mockResolvedValue([]),
      setVehiclePaused: jest.fn().mockResolvedValue(undefined),
    };
    store = new VehicleStateStore();
    service = new OperatingCommandsService(
      kernelApi as unknown as KernelApiService,
      store,
    );
  });

  describe('setCommAdapter(false) — disconnect', () => {
    it('withdraws the running order, then ignores the vehicle, then disables the adapter', async () => {
      store.set('V1', vehicle({ transportOrder: 'TO-1' }));
      const calls: string[] = [];
      kernelApi.withdrawVehicleOrder.mockImplementation(async () => {
        calls.push('withdraw');
      });
      kernelApi.setVehicleIntegrationLevel.mockImplementation(async () => {
        calls.push('ignore');
      });
      kernelApi.setVehicleAdapterEnabled.mockImplementation(async () => {
        calls.push('disable');
      });

      await service.setCommAdapter('V1', false);

      expect(kernelApi.withdrawVehicleOrder).toHaveBeenCalledWith('V1', true);
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'V1',
        'TO_BE_IGNORED',
      );
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith('V1', false);
      expect(calls).toEqual(['withdraw', 'ignore', 'disable']);
    });

    it('skips withdrawal when the vehicle has no running order', async () => {
      store.set('V1', vehicle({ transportOrder: null }));

      await service.setCommAdapter('V1', false);

      expect(kernelApi.withdrawVehicleOrder).not.toHaveBeenCalled();
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'V1',
        'TO_BE_IGNORED',
      );
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith('V1', false);
    });

    it('skips withdrawal when the vehicle is unknown to the store', async () => {
      await service.setCommAdapter('Ghost', false);

      expect(kernelApi.withdrawVehicleOrder).not.toHaveBeenCalled();
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'Ghost',
        'TO_BE_IGNORED',
      );
    });
  });

  describe('setCommAdapter(true) — connect', () => {
    it('only enables the adapter, leaving integration level untouched', async () => {
      await service.setCommAdapter('V1', true);

      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith('V1', true);
      expect(kernelApi.setVehicleIntegrationLevel).not.toHaveBeenCalled();
      expect(kernelApi.withdrawVehicleOrder).not.toHaveBeenCalled();
    });
  });

  describe('fleet("connect-all")', () => {
    it('enables the adapter and sets TO_BE_UTILIZED for every vehicle, without pausing', async () => {
      kernelApi.getVehicles.mockResolvedValue([
        vehicle({ name: 'V1' }),
        vehicle({ name: 'V2' }),
      ]);

      const result = await service.fleet('connect-all');

      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith('V1', true);
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith('V2', true);
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'V1',
        'TO_BE_UTILIZED',
      );
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'V2',
        'TO_BE_UTILIZED',
      );
      expect(kernelApi.setVehiclePaused).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, applied: ['V1', 'V2'], failed: [] });
    });

    it('names per-vehicle failures without throwing, and reports ok:false', async () => {
      kernelApi.getVehicles.mockResolvedValue([vehicle({ name: 'V1' })]);
      kernelApi.setVehicleAdapterEnabled.mockRejectedValueOnce(new Error('offline'));

      const result = await service.fleet('connect-all');

      expect(result).toEqual({
        ok: false,
        applied: [],
        failed: [{ name: 'V1', reason: 'offline' }],
      });
    });

    it('throws instead of reporting a false success when the vehicle list itself fails', async () => {
      kernelApi.getVehicles.mockRejectedValue(new Error('kernel down'));

      await expect(service.fleet('connect-all')).rejects.toThrow('kernel down');

      expect(kernelApi.setVehicleAdapterEnabled).not.toHaveBeenCalled();
    });
  });
});
