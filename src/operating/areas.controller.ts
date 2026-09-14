import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { OperatingAreasService } from './operating-areas.service';
import type {
  AreaDto,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from './dto/operating.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating/areas')
export class OperatingAreasController {
  constructor(
    private readonly areas: OperatingAreasService,
  ) {}

  @Get()
  list(): Promise<AreaDto[]> {
    return this.areas.list();
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
