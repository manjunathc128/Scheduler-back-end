import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    this.client = new Redis({
      host,
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: host !== 'localhost' ? {} : undefined,
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

  /**
 * Set a key only if it doesn't exist (NX = Not eXists)
 * Returns true if the key was set, false if it already existed
 */

  async setnx(key: string, value: string, ttl?: number): Promise<boolean> {
    if (ttl) {
      const result = await this.client.set(key, value, 'EX', ttl, 'NX');
      return result === 'OK';
    } else {
      const result = await this.client.set(key, value, 'NX');
      return result === 'OK';
    }
  }

  /**
   * Get the score of a member in a sorted set
   */
  async zscore(key: string, member: string): Promise<number | null> {
    const result = await this.client.zscore(key, member);
    return result === null ? null : parseFloat(result);
  }

  /**
   * Get members with scores from a sorted set
   */
  async zrangeWithScores(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]> {
    const result = await this.client.zrange(key, start, stop, 'WITHSCORES');
    const pairs: { member: string; score: number }[] = [];
    
    for (let i = 0; i < result.length; i += 2) {
      pairs.push({
        member: result[i],
        score: parseFloat(result[i + 1]),
      });
    }
    
    return pairs;
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

  // ─── Jobs: Distributed Lock & Visibility Timeout ──────────────────────

  /**
   * Acquire a distributed lock for job selection.
   * Uses SET NX EX (atomic check-and-set with TTL).
   * Returns true if lock acquired, false if already held.
   */
  async acquireLock(queueName: string, workerId: string, ttlSeconds = 5): Promise<boolean> {
    return this.setnx(`jobs:lock:${queueName}`, workerId, ttlSeconds);
  }

  /**
   * Release a distributed lock after job selection is complete.
   */
  async releaseLock(queueName: string): Promise<void> {
    await this.client.del(`jobs:lock:${queueName}`);
  }

  /**
   * Set visibility timeout for a job (dead-man's switch).
   * If the worker crashes, this key auto-expires and recovery can re-queue the job.
   */
  async setVisibilityTimeout(jobId: string, workerId: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`jobs:visibility:${jobId}`, workerId, 'EX', ttlSeconds);
  }

  /**
   * Remove visibility timeout after successful job completion.
   */
  async clearVisibilityTimeout(jobId: string): Promise<void> {
    await this.client.del(`jobs:visibility:${jobId}`);
  }

  /**
   * Check if a visibility timeout key exists for a job.
   * Returns the workerId if exists, null otherwise.
   */
  async getVisibilityTimeout(jobId: string): Promise<string | null> {
    return this.client.get(`jobs:visibility:${jobId}`);
  }
}
