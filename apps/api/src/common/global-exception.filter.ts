import type { ErrorResponse } from '@koru/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      const base: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : { ...raw };

      const body: ErrorResponse = {
        statusCode,
        error: HttpStatus[statusCode] ?? 'ERROR',
        message: this.normalizeMessage(base.message),
        ...(base.errors ? { errors: base.errors as ErrorResponse['errors'] } : {}),
      };

      response.status(statusCode).json(body);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));

    const body: ErrorResponse = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }

  private normalizeMessage(message: unknown): string {
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
    return 'Unexpected error';
  }
}
