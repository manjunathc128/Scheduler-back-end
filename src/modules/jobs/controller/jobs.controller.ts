import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JobsService } from '../services/jobs.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CreateJobDto } from '../dto/create-job.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * POST /jobs
   * Submit a new job
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Request() req: any, @Body() dto: CreateJobDto) {
    // req.user is populated by JwtAuthGuard
    const job = await this.jobsService.createJob(req.user.userId, dto);
    
    return {
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        priority: job.priority,
        queueName: job.queueName,
        createdAt: job.createdAt,
      },
    };
  }

  /**
   * GET /jobs/:jobId
   * Get job details
   */
  @Get(':jobId')
  async getJob(@Param('jobId') jobId: string) {
    const job = await this.jobsService.getJob(jobId);
    
    return {
      success: true,
      data: job,
    };
  }

  /**
   * GET /jobs
   * List jobs for the authenticated user
   */
  @Get()
  async listJobs(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.jobsService.listJobsByOwner(
      req.user.userId,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    
    return {
      success: true,
      data: result.jobs,
      meta: {
        total: result.total,
        limit: limit ? parseInt(limit, 10) : 20,
        offset: offset ? parseInt(offset, 10) : 0,
      },
    };
  }
}
