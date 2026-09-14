import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { EMPTY, Observable, catchError, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingVehiclesService } from './operating-vehicles.service';
import { OperatingCargoService } from './operating-cargo.service';
import { OperatingAreasService } from './operating-areas.service';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard)
@Controller('operating')
export class OperatingStreamController {
  constructor(
    private readonly vehicles: OperatingVehiclesService,
    private readonly cargo: OperatingCargoService,
    private readonly areas: OperatingAreasService,
  ) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.vehicles.updates$.pipe(
        map((dto) => ({ data: { kind: 'vehicle', payload: dto } })),
        catchError(() => EMPTY),
      ),
      this.cargo.changes$.pipe(
        map(() => ({ data: { kind: 'cargo' } })),
        catchError(() => EMPTY),
      ),
      this.areas.changes$.pipe(
        map(() => ({ data: { kind: 'area' } })),
        catchError(() => EMPTY),
      ),
      interval(SSE_HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }))),
    );
  }
}
