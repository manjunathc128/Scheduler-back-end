import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Job } from './job.entity';

@Entity('job_executions')
@Index(['jobId'])
@Index(['workerId'])
@Index(['startedAt'])
export class JobExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  executionId: string;

  @Column()
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column()
  workerId: string;

  @Column({ type: 'int' })
  attempt: number;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;
}


export enum ExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}