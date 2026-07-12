import { IsString, IsNumber, IsObject, IsOptional, IsEnum, IsDateString, Min, Max, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryType } from '../entities/job.entity';

class RetryPolicyDto {
  @IsEnum(['exponential', 'linear', 'fixed'])
  strategy: 'exponential' | 'linear' | 'fixed';

  @IsNumber()
  @Min(100)
  initialDelay: number; // in ms

  @IsNumber()
  @Min(1000)
  maxDelay: number; // in ms

  @IsNumber()
  @Min(1)
  backoffMultiplier: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  jitterFactor: number;
}

export class CreateJobDto {
  @IsString()
  queueName: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  priority: number;

  @IsObject()
  payload: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string; // ISO date string

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxRetries?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RetryPolicyDto)
  retryPolicy?: RetryPolicyDto;

  @IsOptional()
  @IsEnum(DeliveryType)
  deliverySemantics?: DeliveryType;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(300)
  visibilityTimeout?: number; // in seconds

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(3600000)
  executionTimeout?: number; // in ms

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string; // Client-provided key to prevent duplicate submissions
}
