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
import { Observable, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingAreasService } from './operating-areas.service';
import type {
  AreaDto,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard)
@Controller('operating/areas')
export class OperatingAreasController {
  constructor(private readonly areas: OperatingAreasService) {}

  @Get()
  list(): Promise<AreaDto[]> {
    return this.areas.list();
  }

  // Declared before `:wesId` routes so "stream" isn't taken as an id. Bare tick — the client
  // refetches the area list (and the plant model, since zone edits move kernel Locations).
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.areas.changes$.pipe(map(() => ({ data: { ts: Date.now() } }) as MessageEvent)),
      interval(SSE_HEARTBEAT_MS).pipe(
        map(() => ({ type: 'ping', data: '' }) as MessageEvent),
      ),
    );
  }

  @Post('sync')
  sync() {
    return this.areas.sync();
  }

  @Post()
  create(@Body() body: CreateAreaBody): Promise<AreaDto> {
    return this.areas.create(body);
  }

  @Patch(':wesId')
  update(@Param('wesId') wesId: string, @Body() body: UpdateAreaBody): Promise<AreaDto> {
    return this.areas.update(wesId, body);
  }

  @Put(':wesId/members')
  replaceMembers(
    @Param('wesId') wesId: string,
    @Body() body: ReplaceAreaMembersBody,
  ): Promise<AreaDto> {
    return this.areas.replaceMembers(wesId, body);
  }

  @Delete(':wesId')
  @HttpCode(200)
  remove(@Param('wesId') wesId: string): Promise<void> {
    return this.areas.remove(wesId);
  }
}
