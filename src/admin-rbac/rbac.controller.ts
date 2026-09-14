import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RbacService } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/rbac.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions/catalogue')
  @RequirePermissions('users.view')
  catalogue() {
    return this.rbac.catalogue();
  }

  @Get('admin/roles')
  @RequirePermissions('users.view')
  listRoles() {
    return this.rbac.list();
  }

  @Post('admin/roles')
  @RequirePermissions('roles.manage')
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.create(dto);
  }

  @Patch('admin/roles/:id')
  @RequirePermissions('roles.manage')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.rbac.update(id, dto);
  }

  @Delete('admin/roles/:id')
  @RequirePermissions('roles.manage')
  @HttpCode(200)
  async removeRole(@Param('id', ParseIntPipe) id: number) {
    await this.rbac.remove(id);
    return { ok: true };
  }
}
