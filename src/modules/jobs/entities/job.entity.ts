import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED',
}

export enum DeliveryType {
  AT_LEAST_ONCE = 'AT_LEAST_ONCE',
  AT_MOST_ONCE = 'AT_MOST_ONCE',
  EXACTLY_ONCE = 'EXACTLY_ONCE',
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'varchar', length: 255, unique: true })
  jobId: string;

  @Index()
  @Column({ name: 'owner_id', type: 'varchar', length: 255 })
  ownerId: string;

  @Index()
  @Column({ name: 'queue_name', type: 'varchar', length: 100 })
  queueName: string;

  @Column({ type: 'varchar', length: 50, default: JobStatus.PENDING })
  status: JobStatus;

  @Column({ type: 'int', default: 50 })
  priority: number;

  @Column({ name: 'base_priority', type: 'int' })
  basePriority: number;

  @Column({ name: 'aging_boost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  agingBoost: number;

  @Column({ name: 'fairness_adjustment', type: 'decimal', precision: 10, scale: 2, default: 0 })
  fairnessAdjustment: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'scheduled_for', type: 'timestamp', nullable: true })
  scheduledFor: Date;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  error: string;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'max_retries', type: 'int', default: 3 })
  maxRetries: number;

  @Column({ name: 'retry_policy', type: 'jsonb' })
  retryPolicy: {
    strategy: 'exponential' | 'linear' | 'fixed';
    initialDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitterFactor: number;
  };

  @Column({ name: 'delivery_semantics', type: 'varchar', length: 50, default: DeliveryType.AT_LEAST_ONCE })
  deliverySemantics: DeliveryType;

  @Column({ name: 'visibility_timeout', type: 'int', default: 30 })
  visibilityTimeout: number;

  @Column({ name: 'execution_timeout', type: 'int', default: 30000 })
  executionTimeout: number;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
