import {
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
import type { AuthUser } from '../auth/jwt-payload';

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

@UseGuards(JwtAuthGuard)
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('kernel-status')
  getKernelStatus() {
    return this.maps.getKernelStatus();
  }

  @Get('current')
  getCurrent() {
    return this.maps.getCurrent();
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
