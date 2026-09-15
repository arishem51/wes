import { OperatingCommandsService } from './operating-commands.service';
import { KernelApiService } from '../../opentcs/kernel-api.service';
import { VehicleStateStore } from '../../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../../opentcs/domain/kernel-model';
import type { OperatingPlantModelService } from './operating-plant-model.service';

function vehicle(
  overrides: Partial<KernelVehicleState> = {},
): KernelVehicleState {
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
      | 'createManualTransportOrder'
      | 'sendInstantAction'
    >
  >;
  let store: VehicleStateStore;
  let plantModel: jest.Mocked<Pick<OperatingPlantModelService, 'locations' | 'locationTypes'>>;
  let service: OperatingCommandsService;

  beforeEach(() => {
    kernelApi = {
      setVehicleAdapterEnabled: jest.fn().mockResolvedValue(undefined),
      setVehicleIntegrationLevel: jest.fn().mockResolvedValue(undefined),
      withdrawVehicleOrder: jest.fn().mockResolvedValue(undefined),
      getVehicles: jest.fn().mockResolvedValue([]),
      setVehiclePaused: jest.fn().mockResolvedValue(undefined),
      createManualTransportOrder: jest
        .fn()
        .mockResolvedValue({ name: 'TO-1' }),
      sendInstantAction: jest.fn().mockResolvedValue(undefined),
    };
    store = new VehicleStateStore();
    plantModel = {
      locations: jest.fn().mockResolvedValue([]),
      locationTypes: jest.fn().mockResolvedValue([]),
    };
    service = new OperatingCommandsService(
      kernelApi as unknown as KernelApiService,
      store,
      plantModel as unknown as OperatingPlantModelService,
    );
  });

  describe('createOrder', () => {
    it('sends a bare point through unchanged for MOVE/NOP', async () => {
      await service.createOrder({
        destinations: [{ name: 'P1', operation: 'MOVE' }],
      });

      expect(kernelApi.createManualTransportOrder).toHaveBeenCalledWith(
        [{ locationName: 'P1', operation: 'MOVE' }],
        { intendedVehicle: undefined, type: undefined },
      );
    });

    it('resolves a point + real action to the Location linked to that point supporting it', async () => {
      plantModel.locations.mockResolvedValue([
        { name: 'location_P1', type: 'Charging', pointNames: ['P1'] },
      ]);
      plantModel.locationTypes.mockResolvedValue([
        { name: 'Charging', allowedOperations: ['Charge'] },
      ]);

      await service.createOrder({
        destinations: [{ name: 'P1', operation: 'Charge' }],
      });

      expect(kernelApi.createManualTransportOrder).toHaveBeenCalledWith(
        [{ locationName: 'location_P1', operation: 'Charge' }],
        { intendedVehicle: undefined, type: undefined },
      );
    });

    it('rejects a point + action combination no Location there supports', async () => {
      plantModel.locations.mockResolvedValue([
        { name: 'location_P1', type: 'Pick up', pointNames: ['P1'] },
      ]);
      plantModel.locationTypes.mockResolvedValue([
        { name: 'Pick up', allowedOperations: ['liftUp'] },
      ]);

      await expect(
        service.createOrder({
          destinations: [{ name: 'P1', operation: 'Charge' }],
        }),
      ).rejects.toThrow(/không có Location nào hỗ trợ/);
      expect(kernelApi.createManualTransportOrder).not.toHaveBeenCalled();
    });

    it('rejects with no destinations at all', async () => {
      await expect(service.createOrder({ destinations: [] })).rejects.toThrow(
        'Cần ít nhất 1 điểm đến.',
      );
    });

    it('passes a real Location name through unchanged (a caller bypassing the point-based UI)', async () => {
      plantModel.locations.mockResolvedValue([
        { name: 'location_P1', type: 'Charging', pointNames: ['P1'] },
      ]);

      await service.createOrder({
        destinations: [{ name: 'location_P1', operation: 'Charge' }],
      });

      expect(kernelApi.createManualTransportOrder).toHaveBeenCalledWith(
        [{ locationName: 'location_P1', operation: 'Charge' }],
        { intendedVehicle: undefined, type: undefined },
      );
    });
  });

  describe('stopCharging', () => {
    it('sends a VDA5050 "stopCharging" instant action straight to the vehicle', async () => {
      const result = await service.stopCharging('V1');

      expect(kernelApi.sendInstantAction).toHaveBeenCalledWith(
        'V1',
        'stopCharging',
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('setCommAdapter(false) — disconnect', () => {
    it('withdraws the running order, then ignores the vehicle, then disables the adapter', async () => {
      store.set('V1', vehicle({ transportOrder: 'TO-1' }));
      const calls: string[] = [];
      kernelApi.withdrawVehicleOrder.mockImplementation(() => {
        calls.push('withdraw');
        return Promise.resolve();
      });
      kernelApi.setVehicleIntegrationLevel.mockImplementation(() => {
        calls.push('ignore');
        return Promise.resolve();
      });
      kernelApi.setVehicleAdapterEnabled.mockImplementation(() => {
        calls.push('disable');
        return Promise.resolve();
      });

      await service.setCommAdapter('V1', false);

      expect(kernelApi.withdrawVehicleOrder).toHaveBeenCalledWith('V1', true);
      expect(kernelApi.setVehicleIntegrationLevel).toHaveBeenCalledWith(
        'V1',
        'TO_BE_IGNORED',
      );
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith(
        'V1',
        false,
      );
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
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith(
        'V1',
        false,
      );
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

      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith(
        'V1',
        true,
      );
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

      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith(
        'V1',
        true,
      );
      expect(kernelApi.setVehicleAdapterEnabled).toHaveBeenCalledWith(
        'V2',
        true,
      );
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
      kernelApi.setVehicleAdapterEnabled.mockRejectedValueOnce(
        new Error('offline'),
      );

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
