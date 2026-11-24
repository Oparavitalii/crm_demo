import { ERROR_CODES, type ErrorCode } from '@crm/shared';

export { ERROR_CODES, type ErrorCode };

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public meta?: Record<string, unknown>,
    public status = 400,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(ERROR_CODES.NOT_FOUND, { entity }, 404);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(reason?: string) {
    super(ERROR_CODES.FORBIDDEN, reason ? { reason } : undefined, 403);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(ERROR_CODES.UNAUTHORIZED, undefined, 401);
    this.name = 'UnauthorizedError';
  }
}
