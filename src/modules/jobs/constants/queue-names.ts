/**
 * BullMQ queue names — one per job type.
 * Each queue has its own BullMQ queue + Redis sorted set + processor.
 *
 * To add a new job type:
 * 1. Add it here
 * 2. Register BullMQ queue in jobs.module.ts
 * 3. Create a handler implementing JobHandler
 * 4. Register handler in HandlerRegistry
 */
export const QUEUE_NAMES = {
  EMAIL: 'email',
  // WEBHOOK: 'webhook',  ← uncomment when adding webhook support
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
