import { Injectable } from '@nestjs/common';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';

const DEBOUNCE_MS = 1_500;

@Injectable()
export class DispatchSchedulerService {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly releaseEngine: ReleaseEngineService,
    private readonly assignmentEngine: AssignmentEngineService,
  ) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    await this.releaseEngine.run();
    await this.assignmentEngine.run();
  }
}
