import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Respuestas de error homogéneas (RFC 9457 problem+json) sin filtrar stack
 * traces ni detalles internos al cliente (OWASP API8 / CWE-209).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Ocurrió un error inesperado';
    if (exception instanceof HttpException && status < 500) {
      const body = exception.getResponse();
      detail =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
    }
    if (status >= 500) {
      this.logger.error({ requestId: req.id, path: req.path, err: (exception as Error)?.message });
    }
    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title: HttpStatus[status] ?? 'Error', status, detail, requestId: req.id });
  }
}
