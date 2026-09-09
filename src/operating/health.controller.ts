import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { OperatingHealthDto } from './dto/operating.dto';

@UseGuards(JwtAuthGuard)
@Controller('operating/health')
export class OperatingHealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStateStore: VehicleStateStore,
  ) {}

  @Get()
  async check(): Promise<OperatingHealthDto> {
    const [kernelReachable, dbOk] = await Promise.all([
      this.kernelApi.isReachable(),
      this.pingDatabase(),
    ]);

    return {
      kernel: kernelReachable ? 'ok' : 'unreachable',
      kernelSse: {
        connected: this.vehicleStateStore.isConnected(),
        eventCount: 0,
        lastEventAt: null,
      },
      db: dbOk ? 'ok' : 'unreachable',
      mqtt: 'n/a',
    };
  }

  private async pingDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
