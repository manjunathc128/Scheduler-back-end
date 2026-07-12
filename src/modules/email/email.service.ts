import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
  templateId?: string;
  variables?: Record<string, string>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const gmailUser = this.configService.get<string>('GMAIL_USER');
    const gmailAppPassword = this.configService.get<string>('GMAIL_APP_PASSWORD');

    this.fromAddress = gmailUser ?? '';

    // Gmail SMTP transporter — sends to any email address, no domain required
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });
  }

  /**
   * Send an email via Gmail SMTP.
   * Supports default template or future template system.
   */
  async sendEmail(payload: SendEmailPayload): Promise<{ id: string }> {
    const html = payload.templateId
      ? this.renderTemplate(payload.templateId, payload.variables || {})
      : this.renderDefaultTemplate(payload.subject, payload.body);

    const info = await this.transporter.sendMail({
      from: `"Job Scheduler" <${this.fromAddress}>`,
      to: payload.to,
      subject: payload.subject,
      html,
    });

    this.logger.log(`Email sent to ${payload.to} (messageId: ${info.messageId})`);
    return { id: info.messageId };
  }

  /**
   * Default email template — clean HTML layout.
   */
  private renderDefaultTemplate(subject: string, body: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; background-color: #f5f5f5;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #333; margin-top: 0; font-size: 24px;">${subject}</h1>
            <div style="color: #555; font-size: 16px; line-height: 1.6;">
              ${body}
            </div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; margin-bottom: 0;">
              Sent by Job Scheduler
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Template rendering — placeholder for future template system.
   */
  private renderTemplate(templateId: string, variables: Record<string, string>): string {
    let html = this.renderDefaultTemplate(
      variables['subject'] || 'Notification',
      variables['body'] || '',
    );

    for (const [key, value] of Object.entries(variables)) {
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return html;
  }
}
