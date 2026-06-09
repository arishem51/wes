import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RoleEntity,
      UserRoleEntity,
      RefreshTokenEntity,
      UserSessionEntity,
      PasswordResetTokenEntity,
      UserPreferenceEntity,
    ]),
  ],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
