import { Module } from '@nestjs/common';
import { JobEventsGateway } from './job-events.gateway';
import { JobEventsService } from './job-events.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [JobEventsGateway, JobEventsService],
  exports: [JobEventsService],
})
export class EventsModule {}
