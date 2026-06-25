import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';

@Injectable()
export class ReleaseEngineService {
  private readonly logger = new Logger(ReleaseEngineService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
  ) {}

  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.CREATED },
    });

    if (tasks.length === 0) {
      return;
    }

    for (const task of tasks) {
      task.status = TaskStatus.READY_TO_ASSIGN;
    }
    await this.taskRepo.save(tasks);
    this.logger.log(`Released ${tasks.length} task(s) → READY_TO_ASSIGN`);
  }
}
