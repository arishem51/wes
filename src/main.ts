import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // FE-07 API lives under /api (Vite proxies /api → here). The legacy demo
  // routes on AppController stay at the root.
  app.setGlobalPrefix('api', { exclude: ['/', 'transport-order'] });

  app.use(cookieParser());

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
