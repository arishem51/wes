import { Controller, UseGuards, Get } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingVehiclesService } from './operating-vehicles.service';
import type { VehicleRealtimeDto } from './dto/operating.dto';

@UseGuards(JwtAuthGuard)
@Controller('operating/vehicles')
export class OperatingVehiclesController {
  constructor(private readonly vehicles: OperatingVehiclesService) {}

  @Get()
  list(): Promise<VehicleRealtimeDto[]> {
    return this.vehicles.snapshot();
  }
}
