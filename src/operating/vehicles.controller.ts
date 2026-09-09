import { Controller, MessageEvent, Sse, UseGuards, Get } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingVehiclesService } from './operating-vehicles.service';
import type { VehicleRealtimeDto } from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard)
@Controller('operating/vehicles')
export class OperatingVehiclesController {
  constructor(private readonly vehicles: OperatingVehiclesService) {}

  @Get()
  list(): Promise<VehicleRealtimeDto[]> {
    return this.vehicles.snapshot();
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.vehicles.updates$.pipe(map((dto) => ({ data: dto }) as MessageEvent)),
      interval(SSE_HEARTBEAT_MS).pipe(
        map(() => ({ type: 'ping', data: '' }) as MessageEvent),
      ),
    );
  }
}
