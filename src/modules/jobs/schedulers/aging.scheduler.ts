import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from '../services/jobs.service';

/**
 * Aging Scheduler — Algorithm 5
 *
 * Runs every 5 minutes to apply priority boosts to long-waiting jobs.
 * Prevents job starvation by ensuring older jobs eventually bubble
 * to the top of the Redis sorted set regardless of their base priority.
 */
@Injectable()
export class AgingScheduler {
  private readonly logger = new Logger(AgingScheduler.name);

  constructor(private readonly jobsService: JobsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAgingBoost(): Promise<void> {
    this.logger.log('Running aging mechanism...');
    await this.jobsService.applyAgingBoost();
  }
}
