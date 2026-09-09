import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';

const INTEGRATION_LEVELS = new Set([
  'TO_BE_IGNORED',
  'TO_BE_NOTICED',
  'TO_BE_RESPECTED',
  'TO_BE_UTILIZED',
] as const);

type IntegrationLevel = typeof INTEGRATION_LEVELS extends Set<infer T> ? T : never;

const POINT_OPERATIONS = new Set(['MOVE', 'NOP']);

export interface CreateManualOrderDto {
  destinations: { name: string; operation: string }[];
  intendedVehicle?: string;
  type?: string;
}

/** Turn a kernel 4xx into a clean 400 carrying the kernel's own message. */
function rethrowKernel(err: unknown, hint?: string): never {
  if (err instanceof AxiosError && err.response && err.response.status < 500) {
    const data = err.response.data as { message?: string } | string | undefined;
    const raw =
      typeof data === 'string'
        ? data.trim()
        : typeof data?.message === 'string'
          ? data.message
          : '';
    const msg = raw || err.message;
    throw new BadRequestException(
      hint ? `Hệ thống điều khiển từ chối (${msg}). ${hint}` : `Hệ thống điều khiển từ chối: ${msg}`,
    );
  }
  throw err;
}

/**
 * Write-side kernel controls for the operating screen — the same calls an operator would
 * otherwise curl by hand (integration level, pause, comm-adapter, order withdrawal, path lock,
 * manual transport order) plus a fleet-wide pause/resume. No cargo/zone business logic here.
 */
@Injectable()
export class OperatingCommandsService {
  private readonly logger = new Logger(OperatingCommandsService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async createOrder(dto: CreateManualOrderDto): Promise<{ ok: true; name: string }> {
    const destinations = (dto.destinations ?? [])
      .filter((destination) => destination.name)
      .map((destination) => ({
        locationName: destination.name,
        operation: destination.operation || 'MOVE',
      }));
    if (destinations.length === 0) {
      throw new BadRequestException('Cần ít nhất 1 điểm đến.');
    }

    try {
      const created = await this.kernelApi.createManualTransportOrder(destinations, {
        intendedVehicle: dto.intendedVehicle || undefined,
        type: dto.type,
      });
      return { ok: true, name: created.name };
    } catch (err) {
      rethrowKernel(
        err,
        'Kiểm tra: MOVE/NOP chỉ dùng cho điểm; tới Location phải chọn operation của LocationType đó.',
      );
    }
  }

  async withdrawOrder(name: string, immediate: boolean): Promise<{ ok: true }> {
    try {
      await this.kernelApi.withdrawTransportOrder(name, immediate);
    } catch (err) {
      rethrowKernel(err);
    }
    return { ok: true };
  }

  async setIntegrationLevel(name: string, value: string): Promise<{ ok: true }> {
    if (!INTEGRATION_LEVELS.has(value as IntegrationLevel)) {
      throw new BadRequestException(`Mức tích hợp không hợp lệ: ${value}`);
    }
    await this.kernelApi.setVehicleIntegrationLevel(name, value as IntegrationLevel);
    return { ok: true };
  }

  async setPaused(name: string, paused: boolean): Promise<{ ok: true }> {
    await this.kernelApi.setVehiclePaused(name, paused);
    return { ok: true };
  }

  async setCommAdapter(name: string, enabled: boolean): Promise<{ ok: true }> {
    await this.kernelApi.setVehicleAdapterEnabled(name, enabled);
    return { ok: true };
  }

  async withdrawVehicle(name: string, immediate: boolean): Promise<{ ok: true }> {
    await this.kernelApi.withdrawVehicleOrder(name, immediate);
    return { ok: true };
  }

  async sendToPoint(
    name: string,
    point: string,
    operation: string,
  ): Promise<{ ok: true; name: string }> {
    if (!point) throw new BadRequestException('Thiếu điểm đến.');
    const op = operation || 'MOVE';
    if (!POINT_OPERATIONS.has(op)) {
      throw new BadRequestException(`Điểm đến là 1 point — operation phải là MOVE hoặc NOP.`);
    }
    try {
      const created = await this.kernelApi.createManualTransportOrder(
        [{ locationName: point, operation: op }],
        { intendedVehicle: name },
      );
      return { ok: true, name: created.name };
    } catch (err) {
      rethrowKernel(err, 'Điểm đến phải là 1 point (operation MOVE).');
    }
  }

  async setPathLocked(name: string, locked: boolean): Promise<{ ok: true }> {
    try {
      await this.kernelApi.setPathLocked(name, locked);
    } catch (err) {
      rethrowKernel(err);
    }
    return { ok: true };
  }

  /**
   * Fleet pause / resume — the least destructive reading of "stop all" / "run all": pause (or
   * unpause) every vehicle without touching orders. `run-all` also lifts the integration level
   * to TO_BE_UTILIZED so a vehicle that was only being respected can take work.
   */
  async fleet(action: 'run-all' | 'stop-all'): Promise<{
    ok: true;
    applied: number;
    failed: number;
  }> {
    const vehicles = await this.kernelApi
      .getVehicles()
      .catch(() => [] as KernelVehicleState[]);
    const paused = action === 'stop-all';

    const results = await Promise.allSettled(
      vehicles.map(async (vehicle) => {
        await this.kernelApi.setVehiclePaused(vehicle.name, paused);
        if (action === 'run-all') {
          await this.kernelApi.setVehicleIntegrationLevel(vehicle.name, 'TO_BE_UTILIZED');
        }
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(`Fleet ${action}: ${results.length - failed} applied, ${failed} failed`);
    return { ok: true, applied: results.length - failed, failed };
  }
}
