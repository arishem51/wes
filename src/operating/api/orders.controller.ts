import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OperatingOrdersService } from '../application/operating-orders.service';
import type { TransportOrderDto } from '../dto/operating.dto';

@ApiTags('operating')
@UseGuards(JwtAuthGuard)
@Controller('operating/orders')
export class OperatingOrdersController {
  constructor(private readonly orders: OperatingOrdersService) {}

  @Get()
  list(): Promise<TransportOrderDto[]> {
    return this.orders.list();
  }

  @Get(':name')
  get(@Param('name') name: string): Promise<unknown> {
    return this.orders.get(name);
  }
}
