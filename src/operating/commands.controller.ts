import {
  Body,
  Controller,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BadRequestException } from '@nestjs/common';
import {
  OperatingCommandsService,
  type CreateManualOrderDto,
} from './operating-commands.service';

function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operating')
export class OperatingCommandsController {
  constructor(private readonly commands: OperatingCommandsService) {}

  @Post('orders')
  @RequirePermissions('order.create')
  createOrder(@Body() dto: CreateManualOrderDto) {
    return this.commands.createOrder(dto);
  }

  @Post('orders/:name/withdraw')
  @RequirePermissions('order.withdraw')
  withdrawOrder(@Param('name') name: string, @Query('immediate') immediate: string) {
    return this.commands.withdrawOrder(name, bool(immediate));
  }

  @Put('vehicles/:name/integration-level')
  @RequirePermissions('vehicle.integration_level')
  setIntegrationLevel(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setIntegrationLevel(name, value);
  }

  @Put('vehicles/:name/paused')
  @RequirePermissions('vehicle.pause')
  setPaused(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setPaused(name, bool(value));
  }

  @Put('vehicles/:name/comm-adapter')
  @RequirePermissions('vehicle.comm_adapter')
  setCommAdapter(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setCommAdapter(name, bool(value));
  }

  @Post('vehicles/:name/withdraw')
  @RequirePermissions('vehicle.withdraw')
  withdrawVehicle(@Param('name') name: string, @Query('immediate') immediate: string) {
    return this.commands.withdrawVehicle(name, bool(immediate));
  }

  @Post('vehicles/:name/send-to-point')
  @RequirePermissions('vehicle.send_to_point')
  sendToPoint(
    @Param('name') name: string,
    @Query('point') point: string,
    @Query('operation') operation: string,
  ) {
    return this.commands.sendToPoint(name, point, operation);
  }

  @Put('paths/:name/lock')
  @RequirePermissions('path.lock')
  lockPath(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setPathLocked(name, bool(value));
  }

  @Post('fleet/:action')
  @RequirePermissions('fleet.control')
  fleet(@Param('action') action: string) {
    if (action !== 'run-all' && action !== 'stop-all' && action !== 'connect-all') {
      throw new BadRequestException(`Hành động không hợp lệ: ${action}`);
    }
    return this.commands.fleet(action);
  }
}
