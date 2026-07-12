import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from '../services/jobs.service';

/**
 * Crash Recovery Scheduler
 *
 * Runs every 2 minutes to detect and recover jobs whose workers
 * crashed mid-execution (visibility timeout expired but job still
 * shows PROCESSING in the database).
 */
@Injectable()
export class CrashRecoveryScheduler {
  private readonly logger = new Logger(CrashRecoveryScheduler.name);

  constructor(private readonly jobsService: JobsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runCrashRecovery(): Promise<void> {
    this.logger.log('Running crash recovery check...');
    await this.jobsService.recoverStuckJobs();
  }
}
