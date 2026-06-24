import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MapsService } from './maps.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsIn } from 'class-validator';
import type { AuthUser } from '../auth/jwt-payload';
import type { KernelMode } from './maps.service';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

class SetKernelStateDto {
  @IsIn(['MODELLING', 'OPERATING'])
  state!: KernelMode;
}

@UseGuards(JwtAuthGuard)
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('kernel-status')
  getKernelStatus() {
    return this.maps.getKernelStatus();
  }

  @Post('kernel-state')
  @UseGuards(RolesGuard)
  @Roles('admin')
  setKernelState(@Body() dto: SetKernelStateDto) {
    return this.maps.setKernelState(dto.state);
  }

  @Get('current')
  getCurrent() {
    return this.maps.getCurrent();
  }

  @Get('plant-model')
  getPlantModel() {
    return this.maps.getPlantModel();
  }

  @Get('cargo-options')
  getCargoOptions() {
    return this.maps.getCargoOptions();
  }

  @Get('kernel/vehicles')
  getKernelVehicles() {
    return this.maps.getKernelVehicles();
  }

  @Get('kernel/debug')
  getKernelDebug() {
    return this.maps.getKernelDebug();
  }

  @Post('kernel/transport-orders/:name/withdraw')
  withdrawTO(@Param('name') name: string) {
    return this.maps.withdrawTransportOrder(name);
  }

  @Get('kernel/events')
  getKernelEvents(
    @Query('minSequenceNo') minSequenceNo?: string,
    @Query('timeout') timeout?: string,
  ) {
    const seq = Math.max(0, parseInt(minSequenceNo ?? '0', 10) || 0);
    const ms = Math.min(
      10_000,
      Math.max(0, parseInt(timeout ?? '1000', 10) || 1000),
    );
    return this.maps.proxyKernelEvents(seq, ms);
  }

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  upload(@UploadedFile() file: UploadFile, @CurrentUser() user: AuthUser) {
    return this.maps.upload(file.buffer, file.originalname, user.sub);
  }
}
