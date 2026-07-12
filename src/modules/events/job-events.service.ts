import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export type JobEventType =
  | 'job.created'
  | 'job.queued'
  | 'job.enqueued'
  | 'job.processing'
  | 'job.completed'
  | 'job.failed'
  | 'job.retry_scheduled'
  | 'job.timeout'
  | 'job.crash_recovered'
  | 'job.priority_updated';

export interface JobEventPayload {
  jobId: string;
  ownerId: string;
  event: JobEventType;
  queueName: string;
  status: string;
  priority?: number;
  retryCount?: number;
  retryIn?: number;
  error?: string;
  result?: Record<string, any>;
  timestamp: string;
  message: string;
}

/**
 * JobEventsService
 *
 * Central service for emitting WebSocket events to users.
 * Injected by JobsService, processors, and schedulers.
 * The gateway sets the server instance on startup.
 */
@Injectable()
export class JobEventsService {
  private readonly logger = new Logger(JobEventsService.name);
  private server: Server | null = null;

  /** Called by the gateway once Socket.IO server is ready */
  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * Emit a job lifecycle event to the user's room.
   * Room name: user_{ownerId} — all sockets for that user receive it.
   */
  emit(payload: JobEventPayload): void {
    if (!this.server) {
      this.logger.warn('Socket server not initialized — skipping event emit');
      return;
    }

    this.server.to(`user_${payload.ownerId}`).emit('job.event', payload);

    this.logger.debug(
      `Emitted ${payload.event} for job ${payload.jobId} to user_${payload.ownerId}`,
    );
  }
}
