import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis connected successfully');
    });
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  // ─── Auth: Refresh Token Management ───────────────────────────────────

  async setRefreshToken(userId: string, device: string, tokenHash: string, ttl: number): Promise<void> {
    const key = `refresh_token:${userId}:${device}`;
    await this.client.set(key, tokenHash, 'EX', ttl);
  }

  async getRefreshToken(userId: string, device: string): Promise<string | null> {
    const key = `refresh_token:${userId}:${device}`;
    return this.client.get(key);
  }

  async deleteRefreshToken(userId: string, device: string): Promise<void> {
    const key = `refresh_token:${userId}:${device}`;
    await this.client.del(key);
  }

  async deleteAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh_token:${userId}:*`;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  // ─── Auth: Access Token Blacklist ─────────────────────────────────────

  async blacklistAccessToken(token: string, ttl: number): Promise<void> {
    const key = `blacklist:${token}`;
    await this.client.set(key, '1', 'EX', ttl);
  }

  async isAccessTokenBlacklisted(token: string): Promise<boolean> {
    const key = `blacklist:${token}`;
    const result = await this.client.get(key);
    return result !== null;
  }

  // ─── Generic Redis Operations ─────────────────────────────────────────

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.set(key, value, 'EX', ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }
}
