import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';

@Catch()
export class ProductImageErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProductImageUpload');

  catch(error: unknown, host: ArgumentsHost): void {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body: unknown =
      error instanceof HttpException ? error.getResponse() : null;
    const record =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const messages: Record<string, string> = {
      PHOTOROOM_CONFIGURATION:
        'The image service configuration requires attention.',
      PHOTOROOM_REJECTED: 'The image service rejected the processing request.',
      PHOTOROOM_UNAVAILABLE: 'The image service is temporarily unavailable.',
      DEMO_LIMIT_REACHED:
        'The demo is busy or its daily allowance has been used. Please try again later.',
      PROVIDER_ADMISSION_UNAVAILABLE:
        'Image enhancement is temporarily unavailable. Please try again later.',
      GUEST_ORIGIN_DENIED: 'This request origin is not allowed.',
      GUEST_SESSION_INVALID: 'The guest session is invalid.',
      GUEST_SESSION_USED:
        'This guest session has already used its enhancement attempt.',
      GUEST_RATE_LIMIT:
        'The guest demo limit has been reached. Please try again later.',
      GUEST_BUSY: 'The guest demo is busy. Please try again later.',
      GUEST_CLAIM_IN_PROGRESS:
        'This result is being saved. Please retry shortly.',
      GUEST_CLAIM_UNAVAILABLE:
        'The result could not be saved yet. Please retry.',
      UPLOAD_TOO_LARGE:
        'The image exceeds the upload or processing size limit.',
      UPLOAD_DIMENSIONS:
        'The image exceeds 25 megapixels or 10,000 pixels per dimension.',
      UPLOAD_INVALID:
        'The image could not be decoded or the upload request is invalid.',
      AUTH_REQUIRED: 'Authentication is required.',
      PRODUCT_UNAVAILABLE: 'Product not found',
      PROCESSING_FAILED: 'Image processing could not be confirmed.',
    };
    const providerCodes = [
      'PHOTOROOM_CONFIGURATION',
      'PHOTOROOM_REJECTED',
      'PHOTOROOM_UNAVAILABLE',
    ];
    const source = typeof record.message === 'string' ? record.message : '';
    const admissionCodes = [
      'DEMO_LIMIT_REACHED',
      'PROVIDER_ADMISSION_UNAVAILABLE',
      'GUEST_ORIGIN_DENIED',
      'GUEST_SESSION_INVALID',
      'GUEST_SESSION_USED',
      'GUEST_RATE_LIMIT',
      'GUEST_BUSY',
      'GUEST_CLAIM_IN_PROGRESS',
      'GUEST_CLAIM_UNAVAILABLE',
    ];
    const code =
      typeof record.code === 'string' &&
      [...providerCodes, ...admissionCodes].includes(record.code)
        ? record.code
        : status === 401
          ? 'AUTH_REQUIRED'
          : status === 403 || status === 404
            ? 'PRODUCT_UNAVAILABLE'
            : status === 413
              ? 'UPLOAD_TOO_LARGE'
              : status === 400 && source.includes('25 megapixel')
                ? 'UPLOAD_DIMENSIONS'
                : status === 400 || status === 422
                  ? 'UPLOAD_INVALID'
                  : 'PROCESSING_FAILED';
    const requestId = randomUUID();
    const providerStatus =
      providerCodes.includes(code) &&
      typeof record.providerStatus === 'number' &&
      Number.isInteger(record.providerStatus)
        ? record.providerStatus
        : undefined;
    // Never log raw exceptions/Axios objects: they can contain the API key,
    // request headers, image contents, prompts or provider response data.
    this.logger.warn(
      JSON.stringify({
        requestId,
        code,
        status,
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      }),
    );
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        code,
        message: messages[code],
        requestId,
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      });
  }
}
