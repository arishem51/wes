import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AgvsService } from './agvs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { CreateAgvDto, ListAgvsQueryDto, UpdateAgvDto } from './dto/agvs.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('agvs')
export class AgvsController {
  constructor(private readonly service: AgvsService) {}

  @Get()
  list(@Query() query: ListAgvsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAgvDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgvDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/connect')
  @HttpCode(204)
  connect(@Param('id') id: string) {
    return this.service.connect(id);
  }

  @Post(':id/disconnect')
  @HttpCode(204)
  disconnect(@Param('id') id: string) {
    return this.service.disconnect(id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@Param('id') id: string) {
    return this.service.enable(id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@Param('id') id: string) {
    return this.service.disable(id);
  }

  @Post(':id/ignore')
  @HttpCode(200)
  ignore(@Param('id') id: string) {
    return this.service.ignore(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }

  @Post(':id/position')
  @HttpCode(204)
  setPosition(@Param('id') id: string, @Body('pointName') pointName: string) {
    return this.service.setPosition(id, pointName);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
