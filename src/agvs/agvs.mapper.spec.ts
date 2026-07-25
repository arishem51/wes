import { AgvEntity } from './entities/agv.entity';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import {
  acceptanceStatusOf,
  resolveKernelStatus,
  toAgvDto,
} from './agvs.mapper';

const entity = (o: Partial<AgvEntity> = {}): AgvEntity =>
  ({
    id: 'a1',
    code: 'AGV-01',
    name: 'V1',
    model: null,
    manufacturer: null,
    serialNumber: null,
    initialPosition: null,
    isDispatchEnabled: true,
    isIgnored: false,
    criticalBatteryThreshold: 20,
    sufficientBatteryThreshold: 60,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-02T00:00:00Z'),
    createdById: 'u1',
    ...o,
  }) as AgvEntity;

const vehicle = (integrationLevel: string): KernelVehicleState =>
  ({ integrationLevel }) as unknown as KernelVehicleState;

describe('agvs.mapper', () => {
  describe('acceptanceStatusOf', () => {
    it('returns IGNORED regardless of dispatch flag', () => {
      expect(acceptanceStatusOf(entity({ isIgnored: true }))).toBe('IGNORED');
      expect(
        acceptanceStatusOf(
          entity({ isIgnored: true, isDispatchEnabled: true }),
        ),
      ).toBe('IGNORED');
    });

    it('returns ENABLED / DISABLED by the dispatch flag when not ignored', () => {
      expect(acceptanceStatusOf(entity({ isDispatchEnabled: true }))).toBe(
        'ENABLED',
      );
      expect(acceptanceStatusOf(entity({ isDispatchEnabled: false }))).toBe(
        'DISABLED',
      );
    });
  });

  describe('resolveKernelStatus', () => {
    it('is unknown when the kernel is unreachable', () => {
      expect(resolveKernelStatus(false, undefined)).toBe('unknown');
      expect(resolveKernelStatus(false, vehicle('TO_BE_UTILIZED'))).toBe(
        'unknown',
      );
    });

    it('is unreachable when reachable but the vehicle is absent', () => {
      expect(resolveKernelStatus(true, undefined)).toBe('unreachable');
    });

    it('is connected when the vehicle is TO_BE_UTILIZED', () => {
      expect(resolveKernelStatus(true, vehicle('TO_BE_UTILIZED'))).toBe(
        'connected',
      );
    });

    it('is reachable for any other integration level', () => {
      expect(resolveKernelStatus(true, vehicle('TO_BE_IGNORED'))).toBe(
        'reachable',
      );
    });
  });

  describe('toAgvDto', () => {
    it('maps the entity fields and the supplied kernel status', () => {
      const dto = toAgvDto(
        entity({ name: 'V9', criticalBatteryThreshold: 25 }),
        'connected',
      );
      expect(dto).toMatchObject({
        name: 'V9',
        criticalBatteryThreshold: 25,
        sufficientBatteryThreshold: 60,
        acceptanceStatus: 'ENABLED',
        kernelStatus: 'connected',
      });
    });

    it('does not leak entity-only fields such as updatedAt', () => {
      const dto = toAgvDto(entity(), 'unknown');
      expect('updatedAt' in dto).toBe(false);
    });
  });
});
