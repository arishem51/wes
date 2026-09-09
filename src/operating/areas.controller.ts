import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OperatingAreasService } from './operating-areas.service';
import type {
  AreaDto,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from './dto/operating.dto';

@UseGuards(JwtAuthGuard)
@Controller('operating/areas')
export class OperatingAreasController {
  constructor(private readonly areas: OperatingAreasService) {}

  @Get()
  list(): Promise<AreaDto[]> {
    return this.areas.list();
  }

  @Post('sync')
  sync() {
    return this.areas.sync();
  }

  @Post()
  create(@Body() body: CreateAreaBody): Promise<AreaDto> {
    return this.areas.create(body);
  }

  @Patch(':wesId')
  update(@Param('wesId') wesId: string, @Body() body: UpdateAreaBody): Promise<AreaDto> {
    return this.areas.update(wesId, body);
  }

  @Put(':wesId/members')
  replaceMembers(
    @Param('wesId') wesId: string,
    @Body() body: ReplaceAreaMembersBody,
  ): Promise<AreaDto> {
    return this.areas.replaceMembers(wesId, body);
  }

  @Delete(':wesId')
  @HttpCode(200)
  remove(@Param('wesId') wesId: string): Promise<void> {
    return this.areas.remove(wesId);
  }
}
