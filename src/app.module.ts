import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OpenTcsModule } from './opentcs/opentcs.module';

@Module({
  imports: [OpenTcsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
