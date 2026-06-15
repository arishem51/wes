import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy, RolesGuard],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
