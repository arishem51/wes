import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { OperatingCargoService } from './operating-cargo.service';
import type { CargoDto, CreateCargoBody } from './dto/operating.dto';

@UseGuards(JwtAuthGuard)
@Controller('operating/cargo')
export class OperatingCargoController {
  constructor(private readonly cargo: OperatingCargoService) {}

  @Get()
  list(): Promise<CargoDto[]> {
    return this.cargo.list();
  }

  @Post()
  create(
    @Body() body: CreateCargoBody,
    @CurrentUser() user: AuthUser,
  ): Promise<CargoDto> {
    return this.cargo.create(body, user.sub);
  }

  @Delete(':id')
  cancel(@Param('id') id: string): Promise<CargoDto> {
    return this.cargo.cancel(id);
  }
}
