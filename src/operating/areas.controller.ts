import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Patch,
  Post,
  Put,
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
import { OperatingAreasService } from './operating-areas.service';
import type {
  AreaDto,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating/areas')
export class OperatingAreasController {
  constructor(
    private readonly areas: OperatingAreasService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get()
  list(): Promise<AreaDto[]> {
    return this.areas.list();
  }

  // Declared before `:wesId` routes so "stream" isn't taken as an id. Bare tick — the client
  // refetches the area list (and the plant model, since zone edits move kernel Locations).
  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return merge(
      this.areas.changes$.pipe(map(() => ({ data: { ts: Date.now() } }) as MessageEvent)),
      sseHeartbeat$(SSE_HEARTBEAT_MS, this.users, this.tokens, user),
    );
  }

  @Post('sync')
  @RequirePermissions('area.sync_kernel')
  sync() {
    return this.areas.sync();
  }

  @Post()
  @RequirePermissions('area.create')
  create(@Body() body: CreateAreaBody): Promise<AreaDto> {
    return this.areas.create(body);
  }

  @Patch(':wesId')
  @RequirePermissions('area.edit')
  update(@Param('wesId') wesId: string, @Body() body: UpdateAreaBody): Promise<AreaDto> {
    return this.areas.update(wesId, body);
  }

  @Put(':wesId/members')
  @RequirePermissions('area.edit')
  replaceMembers(
    @Param('wesId') wesId: string,
    @Body() body: ReplaceAreaMembersBody,
  ): Promise<AreaDto> {
    return this.areas.replaceMembers(wesId, body);
  }

  @Delete(':wesId')
  @RequirePermissions('area.delete')
  @HttpCode(200)
  remove(@Param('wesId') wesId: string): Promise<void> {
    return this.areas.remove(wesId);
  }
}
