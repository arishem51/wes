import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZoneService } from './zone.service';
import { CreateZoneDto } from './zone.dto';

@UseGuards(JwtAuthGuard)
@Controller('zones')
export class ZoneController {
  constructor(private readonly zones: ZoneService) {}

  @Get()
  list() {
    return this.zones.list();
  }

  @Post()
  create(@Body() dto: CreateZoneDto) {
    return this.zones.create(dto);
  }

  @Post('sync')
  sync() {
    return this.zones.sync();
  }
}
