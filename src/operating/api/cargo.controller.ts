import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/jwt-payload';
import { OperatingCargoService } from '../application/operating-cargo.service';
import type { CargoDto, CargoListDto } from '../dto/operating.dto';
import { CreateCargoBody } from '../dto/operating.dto';

@ApiTags('operating')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating/cargo')
export class OperatingCargoController {
  constructor(private readonly cargo: OperatingCargoService) {}

  @Get()
  list(): Promise<CargoListDto> {
    return this.cargo.list();
  }

  @Post()
  @RequirePermissions('cargo.create')
  create(
    @Body() body: CreateCargoBody,
    @CurrentUser() user: AuthUser,
  ): Promise<CargoDto> {
    return this.cargo.create(body, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('cargo.cancel')
  cancel(@Param('id') id: string): Promise<CargoDto> {
    return this.cargo.cancel(id);
  }
}
