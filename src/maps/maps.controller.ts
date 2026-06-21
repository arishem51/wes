import {
  Body,
  Controller,
  Get,
  Post,
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

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  upload(
    @UploadedFile() file: UploadFile,
    @CurrentUser() user: AuthUser,
  ) {
    return this.maps.upload(file.buffer, file.originalname, user.sub);
  }
}
