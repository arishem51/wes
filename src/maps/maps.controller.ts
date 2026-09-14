import {
  BadRequestException,
  Controller,
  Get,
  Header,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { MapsService } from './maps.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';

const SSE_HEARTBEAT_MS = 5_000;

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('maps')
export class MapsController {
  constructor(
    private readonly maps: MapsService,
    private readonly vehicleStateStore: VehicleStateStore,
  ) {}

  @Get('kernel-status')
  getKernelStatus() {
    return this.maps.getKernelStatus();
  }

  @Get('current')
  getCurrent() {
    return this.maps.getCurrent();
  }

  @Get('plant-model')
  getPlantModel() {
    return this.maps.getPlantModel();
  }

  @Get('health')
  getHealth() {
    return this.maps.getHealth();
  }

  @Get('plant-model/xml')
  @RequirePermissions('map.download')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getPlantModelXml(): Promise<string> {
    const xml = await this.maps.getPlantModelXml();
    if (xml == null)
      throw new NotFoundException('Kernel has no plant model loaded.');
    return xml;
  }

  @Get('cargo-options')
  getCargoOptions() {
    return this.maps.getCargoOptions();
  }

  @Get('kernel/vehicles')
  getKernelVehicles() {
    return this.maps.getKernelVehicles();
  }

  @Sse('kernel/sse')
  vehicleStream(): Observable<MessageEvent> {
    return merge(
      this.vehicleStateStore.vehicleUpdates.pipe(
        map((vehicle) => ({ data: vehicle })),
      ),
      interval(SSE_HEARTBEAT_MS).pipe(
        map(() => ({ type: 'heartbeat', data: '' })),
      ),
    );
  }

  @Get('kernel/debug')
  getKernelDebug() {
    return this.maps.getKernelDebug();
  }

  @Post('kernel/transport-orders/:name/withdraw')
  @RequirePermissions('order.withdraw')
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

  @Get('library')
  getLibrary() {
    return this.maps.listLibrary();
  }

  @Get('library/:id/xml')
  @RequirePermissions('map.download')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getLibraryXml(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.maps.getLibraryXml(id);
    const fallback = file.filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return file.content;
  }

  @Get('library/:id')
  getLibraryMap(@Param('id') id: string) {
    return this.maps.getLibraryMap(id);
  }

  @Post('library')
  @RequirePermissions('map.upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  uploadToLibrary(
    @UploadedFile() file: UploadFile | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Vui lòng chọn file XML.');
    return this.maps.uploadToLibrary(file.buffer, file.originalname, user.sub);
  }

  @Post('library/:id/load')
  @RequirePermissions('map.upload')
  loadLibraryMap(@Param('id') id: string) {
    return this.maps.loadLibraryMap(id);
  }
}
