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
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { MapLibraryService } from '../application/map-library.service';
import { KernelMapService } from '../application/kernel-map.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/jwt-payload';
import { VehicleStateStore } from '../../opentcs/vehicle-state.store';
import { ActiveMapRecordService } from '../infrastructure/active-map-record.service';
import { ActiveMapScopeGuard } from './active-map-scope.guard';

const SSE_HEARTBEAT_MS = 5_000;

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

@ApiTags('maps')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('maps')
export class MapsController {
  constructor(
    private readonly mapLibrary: MapLibraryService,
    private readonly kernelMap: KernelMapService,
    private readonly vehicleStateStore: VehicleStateStore,
    private readonly activeMaps: ActiveMapRecordService,
  ) {}

  @Get('kernel-status')
  getKernelStatus() {
    return this.kernelMap.getKernelStatus();
  }

  @Get('current')
  @UseGuards(ActiveMapScopeGuard)
  getCurrent() {
    return this.kernelMap.getCurrent();
  }

  @Get('plant-model')
  @UseGuards(ActiveMapScopeGuard)
  getPlantModel() {
    return this.kernelMap.getPlantModel();
  }

  @Get('health')
  @UseGuards(ActiveMapScopeGuard)
  getHealth() {
    return this.kernelMap.getHealth();
  }

  @Get('plant-model/xml')
  @UseGuards(ActiveMapScopeGuard)
  @RequirePermissions('map.download')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getPlantModelXml(): Promise<string> {
    const xml = await this.kernelMap.getPlantModelXml();
    if (xml == null)
      throw new NotFoundException('Kernel has no plant model loaded.');
    return xml;
  }

  @Get('cargo-options')
  @UseGuards(ActiveMapScopeGuard)
  getCargoOptions() {
    return this.kernelMap.getCargoOptions();
  }

  @Get('kernel/vehicles')
  getKernelVehicles() {
    return this.kernelMap.getKernelVehicles();
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
  @UseGuards(ActiveMapScopeGuard)
  getKernelDebug() {
    return this.kernelMap.getKernelDebug();
  }

  @Post('kernel/transport-orders/:name/withdraw')
  @RequirePermissions('order.withdraw')
  withdrawTO(@Param('name') name: string) {
    return this.kernelMap.withdrawTransportOrder(name);
  }

  @Get('kernel/events')
  @UseGuards(ActiveMapScopeGuard)
  getKernelEvents(
    @Query('minSequenceNo') minSequenceNo?: string,
    @Query('timeout') timeout?: string,
  ) {
    const seq = Math.max(0, parseInt(minSequenceNo ?? '0', 10) || 0);
    const ms = Math.min(
      10_000,
      Math.max(0, parseInt(timeout ?? '1000', 10) || 1000),
    );
    return this.kernelMap.proxyKernelEvents(seq, ms);
  }

  @Get('library')
  getLibrary(@CurrentUser() user: AuthUser) {
    return this.mapLibrary.listLibrary(user.mapIds);
  }

  @Get('active-identity')
  async activeIdentity() {
    return { mapRecordId: await this.activeMaps.resolveId() };
  }

  @Get('library/:id/xml')
  @RequirePermissions('map.download')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getLibraryXml(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.mapLibrary.getLibraryXml(id, user.mapIds);
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
  getLibraryMap(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mapLibrary.getLibraryMap(id, user.mapIds);
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
    return this.mapLibrary.uploadToLibrary(
      file.buffer,
      file.originalname,
      user.sub,
    );
  }

  @Post('library/:id/load')
  @RequirePermissions('map.upload')
  loadLibraryMap(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mapLibrary.loadLibraryMap(id, user.mapIds);
  }
}
