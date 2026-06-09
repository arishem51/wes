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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import {
  CreateAdminUserDto,
  LockDto,
  SetRoleDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';
import type { FeRole, UserStatus } from '../users/user.mapper';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminUsersService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('role') role?: FeRole | 'all',
    @Query('status') status?: UserStatus | 'all',
  ) {
    return this.admin.list({ search, role, status });
  }

  @Post()
  create(@Body() dto: CreateAdminUserDto, @CurrentUser() actor: AuthUser) {
    return this.admin.create(dto, actor.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto, @CurrentUser() actor: AuthUser) {
    return this.admin.update(id, dto, actor.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.admin.remove(id);
  }

  @Put(':id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto, @CurrentUser() actor: AuthUser) {
    return this.admin.setRole(id, dto.role, actor.sub);
  }

  @Post(':id/lock')
  lock(@Param('id') id: string, @Body() dto: LockDto) {
    return this.admin.lock(id, dto.reason);
  }

  @Post(':id/unlock')
  unlock(@Param('id') id: string) {
    return this.admin.unlock(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.admin.activate(id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@Param('id') id: string) {
    await this.admin.resetPassword(id);
    return { ok: true };
  }
}
