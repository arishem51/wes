import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { sseHeartbeat$ } from '../auth/sse-heartbeat';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import type { AuthUser } from '../auth/jwt-payload';
import { OperatingCargoService } from './operating-cargo.service';
import type { CargoDto, CargoListDto, CreateCargoBody } from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating/cargo')
export class OperatingCargoController {
  constructor(
    private readonly cargo: OperatingCargoService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get()
  list(): Promise<CargoListDto> {
    return this.cargo.list();
  }

  // Declared before `:id` so "stream" isn't taken as a cargo id. Payload is a bare tick — the
  // client re-fetches GET /operating/cargo on each one.
  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return merge(
      this.cargo.changes$.pipe(map(() => ({ data: { ts: Date.now() } }) as MessageEvent)),
      sseHeartbeat$(SSE_HEARTBEAT_MS, this.users, this.tokens, user),
    );
  }

  @Post()
  @RequirePermissions('cargo.create')
  create(@Body() body: CreateCargoBody, @CurrentUser() user: AuthUser): Promise<CargoDto> {
    return this.cargo.create(body, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('cargo.cancel')
  cancel(@Param('id') id: string): Promise<CargoDto> {
    return this.cargo.cancel(id);
  }
}
