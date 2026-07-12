import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job as BullJob } from 'bullmq';
import { JobsService } from '../services/jobs.service';
import { QUEUE_NAMES } from '../constants/queue-names';

/**
 * Email queue processor.
 * Handles jobs submitted with queueName: "email".
 * Has its own BullMQ worker — isolated from other queue types.
 */
@Processor(QUEUE_NAMES.EMAIL)
export class EmailQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private readonly jobsService: JobsService) {
    super();
  }

  async process(bullJob: BullJob<{ jobId: string; queueName: string }>): Promise<void> {
    const { queueName } = bullJob.data;
    const workerId = `worker_${QUEUE_NAMES.EMAIL}_${this.worker.id}`;

    this.logger.log(`Worker ${workerId} picking from queue: ${queueName}`);

    // Algorithm 2: Select highest-priority job from Redis sorted set
    const job = await this.jobsService.selectNextJob(queueName, workerId);

    if (!job) {
      this.logger.warn(`No pending job found in queue '${queueName}'`);
      return;
    }

    this.logger.log(`Selected job ${job.jobId} (priority: ${job.priority})`);

    // Algorithm 3: Execute with delivery semantics
    const result = await this.jobsService.executeJob(job, workerId);

    this.logger.log(`Job ${job.jobId} result: ${result.status}`);
  }
}

// ─── Future processors (uncomment as you add queue types) ─────────────────
//
// @Processor(QUEUE_NAMES.WEBHOOK)
// export class WebhookQueueProcessor extends WorkerHost {
//   constructor(private readonly jobsService: JobsService) { super(); }
//   async process(bullJob: BullJob<{ jobId: string; queueName: string }>): Promise<void> {
//     const workerId = `worker_webhook_${this.worker.id}`;
//     const job = await this.jobsService.selectNextJob(bullJob.data.queueName, workerId);
//     if (job) await this.jobsService.executeJob(job, workerId);
//   }
// }
