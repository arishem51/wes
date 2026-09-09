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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BadRequestException } from '@nestjs/common';
import {
  OperatingCommandsService,
  type CreateManualOrderDto,
} from './operating-commands.service';

function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

@UseGuards(JwtAuthGuard)
@Controller('operating')
export class OperatingCommandsController {
  constructor(private readonly commands: OperatingCommandsService) {}

  @Post('orders')
  createOrder(@Body() dto: CreateManualOrderDto) {
    return this.commands.createOrder(dto);
  }

  @Post('orders/:name/withdraw')
  withdrawOrder(@Param('name') name: string, @Query('immediate') immediate: string) {
    return this.commands.withdrawOrder(name, bool(immediate));
  }

  @Put('vehicles/:name/integration-level')
  setIntegrationLevel(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setIntegrationLevel(name, value);
  }

  @Put('vehicles/:name/paused')
  setPaused(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setPaused(name, bool(value));
  }

  @Put('vehicles/:name/comm-adapter')
  setCommAdapter(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setCommAdapter(name, bool(value));
  }

  @Post('vehicles/:name/withdraw')
  withdrawVehicle(@Param('name') name: string, @Query('immediate') immediate: string) {
    return this.commands.withdrawVehicle(name, bool(immediate));
  }

  @Post('vehicles/:name/send-to-point')
  sendToPoint(
    @Param('name') name: string,
    @Query('point') point: string,
    @Query('operation') operation: string,
  ) {
    return this.commands.sendToPoint(name, point, operation);
  }

  @Put('paths/:name/lock')
  lockPath(@Param('name') name: string, @Query('value') value: string) {
    return this.commands.setPathLocked(name, bool(value));
  }

  @Post('fleet/:action')
  @UseGuards(RolesGuard)
  @Roles('admin')
  fleet(@Param('action') action: string) {
    if (action !== 'run-all' && action !== 'stop-all') {
      throw new BadRequestException(`Hành động không hợp lệ: ${action}`);
    }
    return this.commands.fleet(action);
  }
}
