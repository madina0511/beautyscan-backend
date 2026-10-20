import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');

    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    this.resend = new Resend(apiKey);
  }

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    const from = this.configService.get<string>('RESEND_FROM_EMAIL');

    if (!from) {
      throw new Error('RESEND_FROM_EMAIL is not configured');
    }

    try {
      const { error } = await this.resend.emails.send({
        from,
        to: email,
        subject: 'BeautyScan AI - Reset your password',
        text: [
          'You requested a password reset.',
          '',
          `Reset your password: ${resetUrl}`,
          '',
          'This link expires in 15 minutes.',
          'If you did not request this, ignore this email.',
        ].join('\n'),
      });

      if (error) {
        this.logger.error(
          `Resend API failed: ${error.name} - ${error.message}`,
        );

        throw new Error('Resend email delivery failed');
      }

      this.logger.log('Password reset email sent');
    } catch (error: unknown) {
      this.logger.error(
        'Failed to send password reset email',
        error instanceof Error ? error.message : 'Unknown error',
      );

      throw new InternalServerErrorException(
        'Unable to send password reset email',
      );
    }
  }
}
