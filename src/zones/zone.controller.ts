import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ZoneService } from './zone.service';
import {
  AssignZoneMapDto,
  CreateZoneDto,
  ListZonesQueryDto,
  UpdateZoneDto,
} from './zone.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('zones')
export class ZoneController {
  constructor(private readonly zones: ZoneService) {}

  @Get()
  list(@Query() query: ListZonesQueryDto) {
    return this.zones.list({ allMaps: query.allMaps ?? false });
  }

  @Post()
  @RequirePermissions('area.create')
  create(@Body() dto: CreateZoneDto) {
    return this.zones.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('area.edit')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('area.delete')
  remove(@Param('id') id: string) {
    return this.zones.remove(id);
  }

  @Post('sync')
  @RequirePermissions('area.sync_kernel')
  sync() {
    return this.zones.sync();
  }

  @Post('assign-map')
  @HttpCode(200)
  @RequirePermissions('area.edit')
  assignMap(@Body() dto: AssignZoneMapDto) {
    return this.zones.assignToLoadedMap(dto.zoneIds);
  }
}
