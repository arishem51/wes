import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

/**
 * Seed an initial admin so the first login works.
 * Run after applying database/schema.sql:  npm run seed
 */
async function run() {
  const log = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const users = app.get(UsersService);

  const existing = await users.findByUsername('quan.tran');
  if (existing) {
    log.log('Admin "quan.tran" already exists — skipping.');
    await app.close();
    return;
  }

  await users.createUser({
    name: 'Trần Minh Quân',
    username: 'quan.tran',
    email: 'quan.tran@wes.vn',
    phone: '0901 234 567',
    shift: 'Hành chính · Điều phối',
    role: 'admin',
    sendInvite: false,
    password: 'Admin@123',
  });

  log.log('Seeded admin → username: quan.tran  password: Admin@123');
  await app.close();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
