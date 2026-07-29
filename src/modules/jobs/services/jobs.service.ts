import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Job, JobStatus, DeliveryType } from '../entities/job.entity';
import { JobExecution, ExecutionStatus } from '../entities/job-execution.entity';
import { CreateJobDto } from '../dto/create-job.dto';
import { RedisService } from 'src/modules/redis/services/redis.service';
import { HandlerRegistry } from '../handlers/handler-registry';
import { QUEUE_NAMES } from '../constants/queue-names';
import { JobEventsService } from 'src/modules/events/job-events.service';

/** Result of a job execution attempt */
export interface ExecutionResult {
  status: 'SUCCESS' | 'FAILED' | 'RETRY_SCHEDULED';
  jobId: string;
  result?: Record<string, any>;
  error?: string;
  retryIn?: number;
}

/** Custom error for job execution timeouts */
class JobTimeoutError extends Error {
  constructor(jobId: string, timeoutMs: number) {
    super(`Job ${jobId} timed out after ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
  }
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @InjectRepository(JobExecution)
    private readonly jobExecutionRepository: Repository<JobExecution>,
    @InjectQueue(QUEUE_NAMES.EMAIL)
    private readonly emailQueue: Queue,
    private readonly redisService: RedisService,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly jobEventsService: JobEventsService,
    private readonly dataSource: DataSource,
  ) {
    // Map of queueName → BullMQ Queue instance
    // Add new queues here as you expand job types
    this.queueMap = new Map([
      [QUEUE_NAMES.EMAIL, this.emailQueue],
    ]);
  }

  /** Routes BullMQ enqueue calls to the correct queue by job type */
  private readonly queueMap: Map<string, Queue>;

  /**
   * Algorithm 1: Job Submission with Priority Indexing
   * 
   * This method:
   * 1. Checks idempotencyKey to prevent duplicate submissions
   * 2. Generates a unique jobId (prefix + UUID)
   * 3. Calculates final priority (base + aging + fairness)
   * 4. Persists to PostgreSQL
   * 5. Indexes in Redis Sorted Set for priority ordering
   */
  async createJob(ownerId: string, dto: CreateJobDto): Promise<Job> {
    // Step 1: If idempotencyKey provided, check for existing job
    if (dto.idempotencyKey) {
      const existingJob = await this.jobRepository.findOne({
        where: { ownerId, idempotencyKey: dto.idempotencyKey },
      });

      if (existingJob) {
        // Return existing job instead of creating a duplicate
        return existingJob;
      }
    }

    // Step 2: Generate server-side jobId (prefix + UUID)
    const jobId = `job_${randomUUID()}`;

    // Step 3: Calculate final priority
    const finalPriority = this.calculatePriority(dto.priority, 0, 0);

    // Step 4: Create Job entity with defaults
    const job = this.jobRepository.create({
      jobId,
      ownerId,
      queueName: dto.queueName,
      status: JobStatus.PENDING,
      priority: finalPriority,
      basePriority: dto.priority,
      agingBoost: 0,
      fairnessAdjustment: 0,
      payload: dto.payload,
      metadata: dto.metadata || {},
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
      retryCount: 0,
      maxRetries: dto.maxRetries ?? 3,
      retryPolicy: dto.retryPolicy || this.getDefaultRetryPolicy(),
      deliverySemantics: dto.deliverySemantics ?? DeliveryType.AT_LEAST_ONCE,
      visibilityTimeout: dto.visibilityTimeout ?? 30,
      executionTimeout: dto.executionTimeout ?? 30000,
      tags: dto.tags || [],
      idempotencyKey: dto.idempotencyKey || undefined,
    });

    // Step 5: Use transaction for atomicity
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedJob = await queryRunner.manager.save(job);

      // Add to Redis Sorted Set for priority ordering
      await this.redisService.zadd(
        `jobs:queue:${dto.queueName}:pending`,
        finalPriority,
        jobId,
      );

      await queryRunner.commitTransaction();

      // Emit: job created
      this.jobEventsService.emit({
        jobId, ownerId, event: 'job.created',
        queueName: dto.queueName, status: JobStatus.PENDING,
        priority: finalPriority, retryCount: 0,
        timestamp: new Date().toISOString(),
        message: `Job created with priority ${finalPriority}`,
      });

      // Step 6: Enqueue in BullMQ to trigger the worker automatically
      const queue = this.queueMap.get(dto.queueName);
      if (!queue) {
        throw new Error(`No BullMQ queue registered for job type: '${dto.queueName}'`);
      }

      await queue.add(
        'process-job',
        { jobId, queueName: dto.queueName },
        {
          priority: 100 - finalPriority,
          delay: dto.scheduledFor
            ? Math.max(0, new Date(dto.scheduledFor).getTime() - Date.now())
            : undefined,
        },
      );

      // Emit: added to Redis sorted set + enqueued in BullMQ
      this.jobEventsService.emit({
        jobId, ownerId, event: 'job.queued',
        queueName: dto.queueName, status: JobStatus.PENDING,
        priority: finalPriority,
        timestamp: new Date().toISOString(),
        message: `Job added to Redis sorted set (queue: ${dto.queueName})`,
      });

      this.jobEventsService.emit({
        jobId, ownerId, event: 'job.enqueued',
        queueName: dto.queueName, status: JobStatus.PENDING,
        priority: finalPriority,
        timestamp: new Date().toISOString(),
        message: `Job enqueued in BullMQ — worker will pick it up shortly`,
      });

      return savedJob;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a job by its jobId
   */
  async getJob(jobId: string): Promise<Job> {
    const job = await this.jobRepository.findOne({
      where: { jobId },
    });

    if (!job) {
      throw new NotFoundException(`Job '${jobId}' not found`);
    }

    return job;
  }

  /**
   * List jobs by owner
   */
  async listJobsByOwner(ownerId: string, limit = 20, offset = 0): Promise<{ jobs: Job[]; total: number }> {
    const [jobs, total] = await this.jobRepository.findAndCount({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { jobs, total };
  }

  /**
   * Algorithm 2: Job Selection with Fairness
   * 
   * Selects the highest-priority job for a worker to execute.
   * Uses distributed locking to prevent race conditions.
   * 
   * Steps:
   * 1. Acquire distributed lock for the queue
   * 2. Fetch top job from sorted set (highest priority)
   * 3. Validate job still exists and is PENDING
   * 4. Update job status to PROCESSING
   * 5. Set visibility timeout (dead-man's switch)
   * 6. Create JobExecution record
   * 7. Remove job from pending sorted set
   * 8. Release lock
   */
  async selectNextJob(queueName: string, workerId: string): Promise<Job | null> {
    // Step 1: Acquire distributed lock
    const lockAcquired = await this.redisService.acquireLock(queueName, workerId, 5);

    if (!lockAcquired) {
      // Another worker holds the lock, caller should retry
      return null;
    }

    try {
      // Step 2: Fetch top job from sorted set (highest priority first)
      const topJobIds = await this.redisService.zrevrange(
        `jobs:queue:${queueName}:pending`,
        0,
        0,
      );

      if (topJobIds.length === 0) {
        // No pending jobs in this queue
        return null;
      }

      const jobId = topJobIds[0];

      // Step 3: Validate job still exists and is PENDING in the database
      const job = await this.jobRepository.findOne({
        where: { jobId, status: JobStatus.PENDING },
      });

      if (!job) {
        // Job was cancelled or already picked up (stale entry in Redis)
        // Remove the stale entry from the sorted set
        await this.redisService.zrem(`jobs:queue:${queueName}:pending`, jobId);
        return null;
      }

      // Step 4: Update job status to PROCESSING
      job.status = JobStatus.PROCESSING;
      job.startedAt = new Date();
      await this.jobRepository.save(job);

      // Step 5: Set visibility timeout (dead-man's switch for crash recovery)
      await this.redisService.setVisibilityTimeout(
        jobId,
        workerId,
        job.visibilityTimeout,
      );

      // Step 6: Create JobExecution record
      const execution = this.jobExecutionRepository.create({
        executionId: `exec_${randomUUID()}`,
        jobId: job.jobId,
        workerId,
        attempt: job.retryCount + 1,
        status: ExecutionStatus.RUNNING,
      });
      await this.jobExecutionRepository.save(execution);

      // Step 7: Remove job from pending sorted set
      await this.redisService.zrem(`jobs:queue:${queueName}:pending`, jobId);

      // Emit: worker picked up the job
      this.jobEventsService.emit({
        jobId: job.jobId, ownerId: job.ownerId, event: 'job.processing',
        queueName, status: JobStatus.PROCESSING,
        priority: job.priority, retryCount: job.retryCount,
        timestamp: new Date().toISOString(),
        message: `Worker ${workerId} is processing this job`,
      });

      // Step 8: Lock released in finally block
      return job;
    } finally {
      // Always release the lock
      await this.redisService.releaseLock(queueName);
    }
  }

  /**
   * Algorithm 3: Job Execution with Delivery Semantics
   * 
   * Executes a job with timeout handling and processes success/failure
   * based on the configured delivery semantics.
   * 
   * Steps:
   * 1. Start execution with timeout
   * 2. On success: persist result, mark COMPLETED, clear visibility timeout
   * 3. On timeout: handle based on delivery semantics
   * 4. On error: retry with backoff (Algorithm 4) or move to dead-letter
   */
  async executeJob(job: Job, workerId: string): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Step 1: Execute with timeout
      const result = await this.executeWithTimeout(job);

      // Step 2: Success path
      const durationMs = Date.now() - startTime;
      await this.handleJobSuccess(job, workerId, result, durationMs);

      return { status: 'SUCCESS', jobId: job.jobId, result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof JobTimeoutError;

      if (isTimeout) {
        // Step 3: Timeout path
        return this.handleJobTimeout(job, workerId, durationMs);
      }

      // Step 4: Error path
      return this.handleJobError(job, workerId, error, durationMs);
    }
  }

  /**
   * Execute the job handler with a timeout.
   * Wraps execution in a race between the handler and a timeout timer.
   */
  private async executeWithTimeout(job: Job): Promise<Record<string, any>> {
    const timeoutMs = job.executionTimeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new JobTimeoutError(job.jobId, timeoutMs)), timeoutMs);
    });

    const executionPromise = this.runJobHandler(job);

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Run the job handler via the handler registry.
   * Routes to the correct handler based on job.queueName (email, webhook, etc.)
   */
  private async runJobHandler(job: Job): Promise<Record<string, any>> {
    return this.handlerRegistry.execute(job);
  }

  /**
   * Handle successful job completion.
   */
  private async handleJobSuccess(
    job: Job,
    workerId: string,
    result: Record<string, any>,
    durationMs: number,
  ): Promise<void> {
    // Update job status to COMPLETED
    job.status = JobStatus.COMPLETED;
    job.result = result;
    job.completedAt = new Date();
    await this.jobRepository.save(job);

    // Update execution record
    await this.jobExecutionRepository.update(
      { jobId: job.jobId, workerId, status: ExecutionStatus.RUNNING },
      { status: ExecutionStatus.COMPLETED, result, completedAt: new Date(), durationMs },
    );

    // Clear visibility timeout
    await this.redisService.clearVisibilityTimeout(job.jobId);

    this.logger.log(`Job ${job.jobId} completed in ${durationMs}ms`);

    // Emit: job completed
    this.jobEventsService.emit({
      jobId: job.jobId, ownerId: job.ownerId, event: 'job.completed',
      queueName: job.queueName, status: JobStatus.COMPLETED,
      priority: job.priority, retryCount: job.retryCount,
      result, timestamp: new Date().toISOString(),
      message: `Job completed successfully in ${durationMs}ms`,
    });
  }

  /**
   * Handle job timeout based on delivery semantics.
   */
  private async handleJobTimeout(
    job: Job,
    workerId: string,
    durationMs: number,
  ): Promise<ExecutionResult> {
    this.logger.warn(`Job ${job.jobId} timed out after ${durationMs}ms`);

    if (job.deliverySemantics === DeliveryType.AT_MOST_ONCE) {
      // AT_MOST_ONCE: No retry — mark as failed
      job.status = JobStatus.FAILED;
      job.error = `Execution timed out after ${job.executionTimeout}ms`;
      await this.jobRepository.save(job);

      await this.jobExecutionRepository.update(
        { jobId: job.jobId, workerId, status: ExecutionStatus.RUNNING },
        { status: ExecutionStatus.FAILED, error: job.error, completedAt: new Date(), durationMs },
      );

      await this.redisService.clearVisibilityTimeout(job.jobId);
      // Emit: timeout → failed (AT_MOST_ONCE)
      this.jobEventsService.emit({
        jobId: job.jobId, ownerId: job.ownerId, event: 'job.timeout',
        queueName: job.queueName, status: JobStatus.FAILED,
        priority: job.priority, error: job.error,
        timestamp: new Date().toISOString(),
        message: `Job timed out (AT_MOST_ONCE — no retry)`,
      });
      return { status: 'FAILED', jobId: job.jobId, error: job.error };
    }

    // AT_LEAST_ONCE / EXACTLY_ONCE: Retry
    return this.scheduleRetry(job, workerId, `Timed out after ${job.executionTimeout}ms`, durationMs);
  }

  /**
   * Handle job execution error.
   * If retries are available, schedule a retry with backoff (Algorithm 4).
   * Otherwise, move to dead-letter (mark as FAILED permanently).
   */
  private async handleJobError(
    job: Job,
    workerId: string,
    error: unknown,
    durationMs: number,
  ): Promise<ExecutionResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job ${job.jobId} failed: ${errorMessage}`);

    if (job.deliverySemantics === DeliveryType.AT_MOST_ONCE) {
      // No retries for AT_MOST_ONCE
      return this.markJobFailed(job, workerId, errorMessage, durationMs);
    }

    if (job.retryCount < job.maxRetries) {
      // Retry available
      return this.scheduleRetry(job, workerId, errorMessage, durationMs);
    }

    // No retries left — dead-letter
    return this.markJobFailed(job, workerId, errorMessage, durationMs);
  }

  /**
   * Schedule a retry with delay calculated by Algorithm 4 (exponential backoff + jitter).
   */
  private async scheduleRetry(
    job: Job,
    workerId: string,
    errorMessage: string,
    durationMs: number,
  ): Promise<ExecutionResult> {
    // Guard: if retries exhausted, fail permanently instead of retrying
    if (job.retryCount >= job.maxRetries) {
      return this.markJobFailed(job, workerId, errorMessage, durationMs);
    }

    // Algorithm 4: Calculate retry delay
    const delay = this.calculateRetryDelay(job.retryCount, job.retryPolicy);

    // Update job for retry
    job.status = JobStatus.DELAYED;
    job.retryCount += 1;
    job.error = errorMessage;
    await this.jobRepository.save(job);

    // Update execution record
    await this.jobExecutionRepository.update(
      { jobId: job.jobId, workerId, status: ExecutionStatus.RUNNING },
      { status: ExecutionStatus.FAILED, error: errorMessage, completedAt: new Date(), durationMs },
    );

    // Clear visibility timeout
    await this.redisService.clearVisibilityTimeout(job.jobId);

    // Re-enqueue in BullMQ with delay
    const queue = this.queueMap.get(job.queueName);
    if (queue) {
      await queue.add(
        'process-job',
        { jobId: job.jobId, queueName: job.queueName },
        { priority: 100 - job.priority, delay },
      );
    }

    // Re-add to Redis sorted set (will be picked up after delay when BullMQ triggers worker)
    await this.redisService.zadd(
      `jobs:queue:${job.queueName}:pending`,
      job.priority,
      job.jobId,
    );

    // Update job back to PENDING (it's queued for retry)
    job.status = JobStatus.PENDING;
    await this.jobRepository.save(job);

    this.logger.log(`Job ${job.jobId} scheduled for retry #${job.retryCount} in ${delay}ms`);

    // Emit: retry scheduled
    this.jobEventsService.emit({
      jobId: job.jobId, ownerId: job.ownerId, event: 'job.retry_scheduled',
      queueName: job.queueName, status: JobStatus.PENDING,
      priority: job.priority, retryCount: job.retryCount,
      retryIn: delay, error: errorMessage,
      timestamp: new Date().toISOString(),
      message: `Retry #${job.retryCount} scheduled in ${delay}ms`,
    });

    return { status: 'RETRY_SCHEDULED', jobId: job.jobId, retryIn: delay };
  }

  /**
   * Mark job as permanently failed (dead-letter).
   */
  private async markJobFailed(
    job: Job,
    workerId: string,
    errorMessage: string,
    durationMs: number,
  ): Promise<ExecutionResult> {
    job.status = JobStatus.FAILED;
    job.error = errorMessage;
    await this.jobRepository.save(job);

    await this.jobExecutionRepository.update(
      { jobId: job.jobId, workerId, status: ExecutionStatus.RUNNING },
      { status: ExecutionStatus.FAILED, error: errorMessage, completedAt: new Date(), durationMs },
    );

    await this.redisService.clearVisibilityTimeout(job.jobId);

    this.logger.error(`Job ${job.jobId} permanently failed after ${job.retryCount} retries: ${errorMessage}`);

    // Emit: permanently failed
    this.jobEventsService.emit({
      jobId: job.jobId, ownerId: job.ownerId, event: 'job.failed',
      queueName: job.queueName, status: JobStatus.FAILED,
      priority: job.priority, retryCount: job.retryCount,
      error: errorMessage, timestamp: new Date().toISOString(),
      message: `Job permanently failed after ${job.retryCount} retries`,
    });

    return { status: 'FAILED', jobId: job.jobId, error: errorMessage };
  }

  /**
   * Algorithm 4: Retry Logic with Exponential Backoff + Jitter
   * 
   * Calculates delay before next retry attempt.
   * Jitter prevents thundering herd when many jobs fail simultaneously.
   */
  private calculateRetryDelay(
    retryCount: number,
    policy: Job['retryPolicy'],
  ): number {
    let baseDelay: number;

    switch (policy.strategy) {
      case 'exponential':
        baseDelay = policy.initialDelay * Math.pow(policy.backoffMultiplier, retryCount);
        break;
      case 'linear':
        baseDelay = policy.initialDelay * (retryCount + 1);
        break;
      case 'fixed':
        baseDelay = policy.initialDelay;
        break;
    }

    // Cap at maxDelay
    const delay = Math.min(baseDelay, policy.maxDelay);

    // Apply jitter
    const jitter = delay * Math.random() * policy.jitterFactor;

    return Math.round(delay + jitter);
  }

  /**
   * Crash Recovery
   *
   * Finds jobs stuck in PROCESSING with expired visibility timeouts.
   * Visibility key auto-expires when a worker crashes mid-execution.
   * Re-queues the job for retry if eligible, or marks it FAILED.
   * Called periodically by CrashRecoveryScheduler (every 2 minutes).
   */
  async recoverStuckJobs(): Promise<void> {
    // Find all jobs stuck in PROCESSING
    const stuckJobs = await this.jobRepository.find({
      where: { status: JobStatus.PROCESSING },
    });

    if (stuckJobs.length === 0) return;

    this.logger.log(`Crash recovery: checking ${stuckJobs.length} PROCESSING jobs`);

    for (const job of stuckJobs) {
      // Check if the visibility timeout key still exists
      const visibilityKey = await this.redisService.getVisibilityTimeout(job.jobId);

      if (visibilityKey !== null) {
        // Key still exists — worker is alive and processing
        continue;
      }

      // Key expired — worker crashed or timed out without completing
      this.logger.warn(
        `Crash detected for job ${job.jobId} (worker lost visibility key)`,
      );

      // Update the stuck execution record to FAILED
      await this.jobExecutionRepository.update(
        { jobId: job.jobId, status: ExecutionStatus.RUNNING },
        {
          status: ExecutionStatus.FAILED,
          error: 'Worker crashed or lost connection',
          completedAt: new Date(),
        },
      );

      if (job.retryCount < job.maxRetries && job.deliverySemantics !== DeliveryType.AT_MOST_ONCE) {
        // Retry eligible — re-queue with backoff
        const delay = this.calculateRetryDelay(job.retryCount, job.retryPolicy);

        job.status = JobStatus.DELAYED;
        job.retryCount += 1;
        job.error = 'Worker crashed — retrying';
        await this.jobRepository.save(job);

        const queue = this.queueMap.get(job.queueName);
        if (queue) {
          await queue.add(
            'process-job',
            { jobId: job.jobId, queueName: job.queueName },
            { priority: 100 - job.priority, delay },
          );
        }

        await this.redisService.zadd(
          `jobs:queue:${job.queueName}:pending`,
          job.priority,
          job.jobId,
        );

        job.status = JobStatus.PENDING;
        await this.jobRepository.save(job);

        this.logger.log(
          `Job ${job.jobId} re-queued after crash recovery (retry #${job.retryCount}, delay: ${delay}ms)`,
        );

        // Emit: crash recovered → retry
        this.jobEventsService.emit({
          jobId: job.jobId, ownerId: job.ownerId, event: 'job.crash_recovered',
          queueName: job.queueName, status: JobStatus.PENDING,
          priority: job.priority, retryCount: job.retryCount,
          retryIn: delay, timestamp: new Date().toISOString(),
          message: `Worker crash detected — job re-queued for retry #${job.retryCount}`,
        });
      } else {
        // No retries left or AT_MOST_ONCE — permanently fail
        job.status = JobStatus.FAILED;
        job.error = 'Worker crashed — max retries exhausted or AT_MOST_ONCE semantics';
        await this.jobRepository.save(job);

        // Emit: failed after crash
        this.jobEventsService.emit({
          jobId: job.jobId, ownerId: job.ownerId, event: 'job.failed',
          queueName: job.queueName, status: JobStatus.FAILED,
          priority: job.priority, retryCount: job.retryCount,
          error: job.error, timestamp: new Date().toISOString(),
          message: `Job permanently failed after worker crash (no retries left)`,
        });

        this.logger.error(
          `Job ${job.jobId} permanently failed after crash (no retries left)`,
        );
      }
    }
  }

  /**
   * Algorithm 5: Aging Mechanism for Fairness
   *
   * Prevents job starvation by boosting priority of long-waiting jobs.
   * Formula: newPriority = basePriority + (ageInSeconds / 3600) * 10 + fairnessAdjustment
   * Called periodically by AgingScheduler (every 5 minutes).
   */
  async applyAgingBoost(): Promise<void> {
    const queueNames = this.handlerRegistry.getRegisteredQueues();

    for (const queueName of queueNames) {
      const jobIds = await this.redisService.zrange(
        `jobs:queue:${queueName}:pending`,
        0,
        -1,
      );

      if (jobIds.length === 0) continue;

      this.logger.log(`Aging check: ${jobIds.length} pending jobs in queue '${queueName}'`);

      for (const jobId of jobIds) {
        const job = await this.jobRepository.findOne({
          where: { jobId, status: JobStatus.PENDING },
        });

        if (!job) {
          // Stale entry — clean it up
          await this.redisService.zrem(`jobs:queue:${queueName}:pending`, jobId);
          continue;
        }

        const ageInSeconds = (Date.now() - job.createdAt.getTime()) / 1000;
        const agingBoost = (ageInSeconds / 3600) * 10; // +10 per hour waited
        const newPriority = this.calculatePriority(
          job.basePriority,
          agingBoost,
          job.fairnessAdjustment,
        );

        // Only update if priority actually changed
        if (newPriority === job.priority) continue;

        // Update Redis sorted set score
        await this.redisService.zadd(
          `jobs:queue:${queueName}:pending`,
          newPriority,
          jobId,
        );

        // Update DB
        job.priority = newPriority;
        job.agingBoost = agingBoost;
        await this.jobRepository.save(job);

        this.logger.log(
          `Aged job ${jobId}: priority ${job.basePriority} → ${newPriority} (waited ${Math.round(ageInSeconds)}s)`,
        );

        // Emit: priority updated by aging
        this.jobEventsService.emit({
          jobId: job.jobId, ownerId: job.ownerId, event: 'job.priority_updated',
          queueName: job.queueName, status: job.status,
          priority: newPriority, retryCount: job.retryCount,
          timestamp: new Date().toISOString(),
          message: `Priority boosted ${job.basePriority} → ${newPriority} (waited ${Math.round(ageInSeconds / 60)}min)`,
        });
      }
    }
  }
  private calculatePriority(
    basePriority: number,
    agingBoost: number,
    fairnessAdjustment: number,
  ): number {
    const result = (basePriority || 0) + (agingBoost || 0) + (fairnessAdjustment || 0);
    if (isNaN(result)) return 0;
    return Math.min(100, Math.max(0, result));
  }

  /**
   * Default retry policy if not provided
   */
  private getDefaultRetryPolicy() {
    return {
      strategy: 'exponential' as const,
      initialDelay: 1000,
      maxDelay: 60000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    };
  }
}
