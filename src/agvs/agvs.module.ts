import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgvEntity } from './entities/agv.entity';
import { AgvsService } from './agvs.service';
import { AgvsController } from './agvs.controller';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgvEntity]), OpenTcsModule],
  providers: [AgvsService],
  controllers: [AgvsController],
})
export class AgvsModule {}
