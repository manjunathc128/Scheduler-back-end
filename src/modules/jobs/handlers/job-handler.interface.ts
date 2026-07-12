import { Job } from '../entities/job.entity';

/**
 * Interface for queue-specific job handlers.
 * Each queue type (email, webhook, etc.) implements this.
 */
export interface JobHandler {
  /**
   * The queue name this handler processes.
   */
  queueName: string;

  /**
   * Execute the job and return a result.
   * Throw an error to trigger retry logic.
   */
  handle(job: Job): Promise<Record<string, any>>;
}
