import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Database connection. Schema is hand-managed in `database/schema.sql`, so
 * `synchronize` is OFF — TypeORM only reads/writes the existing tables.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        host: config.get<string>('PGHOST', 'localhost'),
        port: parseInt(config.get<string>('PGPORT', '5432'), 10),
        username: config.get<string>('PGUSER', 'postgres'),
        password: config.get<string>('PGPASSWORD', 'postgres'),
        database: config.get<string>('PGDATABASE', 'wes'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
