import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from './job-handler.interface';
import { EmailJobHandler } from './email.handler';
import { Job } from '../entities/job.entity';

/**
 * Job Handler Registry
 * 
 * Maps queue names to their corresponding handlers.
 * When a job is executed, the registry finds the right handler
 * based on the job's queueName and delegates execution.
 */
@Injectable()
export class HandlerRegistry {
  private readonly logger = new Logger(HandlerRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly emailHandler: EmailJobHandler) {
    this.register(emailHandler);
  }

  private register(handler: JobHandler): void {
    this.handlers.set(handler.queueName, handler);
    this.logger.log(`Registered handler for queue: ${handler.queueName}`);
  }

  /**
   * Execute a job using the appropriate handler for its queue.
   * Throws if no handler is registered for the queue name.
   */
  async execute(job: Job): Promise<Record<string, any>> {
    const handler = this.handlers.get(job.queueName);

    if (!handler) {
      throw new Error(`No handler registered for queue: '${job.queueName}'`);
    }

    return handler.handle(job);
  }

  /**
   * Check if a handler exists for a given queue name.
   */
  hasHandler(queueName: string): boolean {
    return this.handlers.has(queueName);
  }

  /**
   * Get all registered queue names.
   */
  getRegisteredQueues(): string[] {
    return Array.from(this.handlers.keys());
  }
}
