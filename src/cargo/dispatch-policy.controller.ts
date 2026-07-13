import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-payload';
import { DispatchPolicyService } from './dispatch-policy.service';
import {
  CreateDispatchPolicyDto,
  UpdateDispatchPolicyDto,
} from './dispatch-policy.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('dispatch-policies')
export class DispatchPolicyController {
  constructor(private readonly service: DispatchPolicyService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateDispatchPolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDispatchPolicyDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
