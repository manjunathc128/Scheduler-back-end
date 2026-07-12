import { ConfigService } from '@nestjs/config';

export const getRedisConfig = (configService: ConfigService) => ({
  connection: {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: configService.get<number>('REDIS_PORT', 6379),
    password: configService.get<string>('REDIS_PASSWORD') || undefined,
    maxRetriesPerRequest: null,
    tls: configService.get<string>('REDIS_HOST', 'localhost') !== 'localhost' ? {} : undefined,
  },
});
