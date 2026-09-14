import { Controller, MessageEvent, Sse, UseGuards, Get } from '@nestjs/common';
import { Observable, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { sseHeartbeat$ } from '../auth/sse-heartbeat';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import type { AuthUser } from '../auth/jwt-payload';
import { OperatingVehiclesService } from './operating-vehicles.service';
import type { VehicleRealtimeDto } from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard)
@Controller('operating/vehicles')
export class OperatingVehiclesController {
  constructor(
    private readonly vehicles: OperatingVehiclesService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get()
  list(): Promise<VehicleRealtimeDto[]> {
    return this.vehicles.snapshot();
  }

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return merge(
      this.vehicles.updates$.pipe(map((dto) => ({ data: dto }) as MessageEvent)),
      sseHeartbeat$(SSE_HEARTBEAT_MS, this.users, this.tokens, user),
    );
  }
}
