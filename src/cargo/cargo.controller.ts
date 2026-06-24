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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { CreateCargoDto, ListCargosQueryDto } from './cargo.dto';

@UseGuards(JwtAuthGuard)
@Controller('cargo')
export class CargoController {
  constructor(private readonly service: CargoService) {}

  @Get()
  list(@Query() query: ListCargosQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCargoDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
