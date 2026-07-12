import { Injectable, Logger } from '@nestjs/common';
import { EmailService, SendEmailPayload } from 'src/modules/email/email.service';
import { Job } from '../entities/job.entity';
import { JobHandler } from './job-handler.interface';

/**
 * Email Job Handler
 * 
 * Processes jobs from the "email" queue.
 * Sends emails using Resend via EmailService.
 * 
 * Expected payload:
 * {
 *   "to": "user@example.com",
 *   "subject": "Your subject",
 *   "body": "Email body content (HTML supported)",
 *   "templateId?": "welcome-email",
 *   "variables?": { "name": "John" }
 * }
 */
@Injectable()
export class EmailJobHandler implements JobHandler {
  readonly queueName = 'email';
  private readonly logger = new Logger(EmailJobHandler.name);

  constructor(private readonly emailService: EmailService) {}

  async handle(job: Job): Promise<Record<string, any>> {
    const payload = job.payload as SendEmailPayload;

    if (!payload.to || !payload.subject) {
      throw new Error('Email payload must include "to" and "subject" fields');
    }

    this.logger.log(`Sending email to ${payload.to} (job: ${job.jobId})`);

    const result = await this.emailService.sendEmail({
      to: payload.to,
      subject: payload.subject,
      body: payload.body || '',
      templateId: payload.templateId,
      variables: payload.variables,
    });

    return { emailId: result.id, sentTo: payload.to };
  }
}
