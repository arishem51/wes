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
import { Observable, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { OperatingCargoService } from './operating-cargo.service';
import type { CargoDto, CreateCargoBody } from './dto/operating.dto';

const SSE_HEARTBEAT_MS = 15_000;

@UseGuards(JwtAuthGuard)
@Controller('operating/cargo')
export class OperatingCargoController {
  constructor(private readonly cargo: OperatingCargoService) {}

  @Get()
  list(): Promise<CargoDto[]> {
    return this.cargo.list();
  }

  // Declared before `:id` so "stream" isn't taken as a cargo id. Payload is a bare tick — the
  // client re-fetches GET /operating/cargo on each one.
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.cargo.changes$.pipe(map(() => ({ data: { ts: Date.now() } }) as MessageEvent)),
      interval(SSE_HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }

  @Post()
  create(@Body() body: CreateCargoBody, @CurrentUser() user: AuthUser): Promise<CargoDto> {
    return this.cargo.create(body, user.sub);
  }

  @Delete(':id')
  cancel(@Param('id') id: string): Promise<CargoDto> {
    return this.cargo.cancel(id);
  }
}
