import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZoneService } from './zone.service';
import { CreateZoneDto, UpdateZoneDto } from './zone.dto';

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.zones.remove(id);
  }

  @Post('sync')
  sync() {
    return this.zones.sync();
  }
}
