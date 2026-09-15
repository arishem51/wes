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
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/jwt-payload';
import { OperatingAreasService } from '../application/operating-areas.service';
import type { AreaDto } from '../dto/operating.dto';
import {
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from '../dto/operating.dto';

@ApiTags('operating')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating/areas')
export class OperatingAreasController {
  constructor(private readonly areas: OperatingAreasService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AreaDto[]> {
    return this.areas.list(user.mapIds);
  }

  @Post('sync')
  @RequirePermissions('area.sync_kernel')
  sync(@CurrentUser() user: AuthUser) {
    return this.areas.sync(user.mapIds);
  }

  @Post()
  @RequirePermissions('area.create')
  create(
    @Body() body: CreateAreaBody,
    @CurrentUser() user: AuthUser,
  ): Promise<AreaDto> {
    return this.areas.create(body, user.mapIds);
  }

  @Patch(':wesId')
  @RequirePermissions('area.edit')
  update(
    @Param('wesId') wesId: string,
    @Body() body: UpdateAreaBody,
    @CurrentUser() user: AuthUser,
  ): Promise<AreaDto> {
    return this.areas.update(wesId, body, user.mapIds);
  }

  @Put(':wesId/members')
  @RequirePermissions('area.edit')
  replaceMembers(
    @Param('wesId') wesId: string,
    @Body() body: ReplaceAreaMembersBody,
    @CurrentUser() user: AuthUser,
  ): Promise<AreaDto> {
    return this.areas.replaceMembers(wesId, body, user.mapIds);
  }

  @Delete(':wesId')
  @RequirePermissions('area.delete')
  @HttpCode(200)
  remove(
    @Param('wesId') wesId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.areas.remove(wesId, user.mapIds);
  }
}
