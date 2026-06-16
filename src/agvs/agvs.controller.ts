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
import {
  CreateAgvDto,
  ListAgvsQueryDto,
  RegisterAgvDto,
  UpdateAgvDto,
} from './dto/agvs.dto';

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

  @Post('register')
  register(@Body() dto: RegisterAgvDto, @CurrentUser() user: AuthUser) {
    return this.service.register(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgvDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
