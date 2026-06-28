import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OpenTcsModule } from './opentcs/opentcs.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { MapsModule } from './maps/maps.module';
import { AgvsModule } from './agvs/agvs.module';
import { CargoModule } from './cargo/cargo.module';
import { ZoneModule } from './zones/zone.module';

const localEnvFile = resolve(__dirname, '../.env');
const hasLocalEnvFile = existsSync(localEnvFile);

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      ...(hasLocalEnvFile
        ? {
            envFilePath: localEnvFile,
            // Make the repo-local .env authoritative in local dev so stale
            // machine-wide PG* / DATABASE_URL vars don't hijack the DB config.
            skipProcessEnv: true,
          }
        : {}),
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    AccountModule,
    AdminUsersModule,
    OpenTcsModule,
    MapsModule,
    AgvsModule,
    CargoModule,
    ZoneModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
