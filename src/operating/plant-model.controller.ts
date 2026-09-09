import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingPlantModelService } from './operating-plant-model.service';
import type {
  PlantModelLocationTypeDto,
  PlantModelPathDto,
  PlantModelPointsDto,
} from './dto/operating.dto';

@UseGuards(JwtAuthGuard)
@Controller('operating/plant-model')
export class OperatingPlantModelController {
  constructor(private readonly plantModel: OperatingPlantModelService) {}

  @Get('points')
  points(): Promise<PlantModelPointsDto> {
    return this.plantModel.points();
  }

  @Get('paths')
  paths(): Promise<PlantModelPathDto[]> {
    return this.plantModel.paths();
  }

  @Get('location-types')
  locationTypes(): Promise<PlantModelLocationTypeDto[]> {
    return this.plantModel.locationTypes();
  }
}
