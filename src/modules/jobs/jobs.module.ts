import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './controller/jobs.controller';
import { JobsService } from './services/jobs.service';
import { EmailQueueProcessor } from './processors/jobs.processor';
import { HandlerRegistry } from './handlers/handler-registry';
import { EmailJobHandler } from './handlers/email.handler';
import { AgingScheduler } from './schedulers/aging.scheduler';
import { CrashRecoveryScheduler } from './schedulers/crash-recovery.scheduler';
import { Job, JobExecution } from './entities';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { QUEUE_NAMES } from './constants/queue-names';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobExecution]),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAIL },
    ),
    RedisModule,
    EmailModule,
    EventsModule,
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    EmailQueueProcessor,
    HandlerRegistry,
    EmailJobHandler,
    AgingScheduler,
    CrashRecoveryScheduler,
  ],
  exports: [JobsService],
})
export class JobsModule {}
