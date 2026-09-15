import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CargoService } from './cargo.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { CreateCargoDto, ListCargosQueryDto } from './cargo.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cargo')
export class CargoController {
  constructor(
    private readonly service: CargoService,
    private readonly dispatcher: DispatchSchedulerService,
  ) {}

  @Get()
  list(@Query() query: ListCargosQueryDto) {
    return this.service.list(query);
  }

  @Get(':id/decision')
  assignmentDecision(@Param('id') id: string) {
    return this.service.getAssignmentDecision(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('cargo.create')
  create(@Body() dto: CreateCargoDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('cargo.cancel')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('dispatch/trigger')
  @HttpCode(204)
  @RequirePermissions('cargo.create')
  triggerDispatch() {
    this.dispatcher.schedule();
  }
}
