import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingOrdersService } from './operating-orders.service';
import type { TransportOrderDto } from './dto/operating.dto';

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
