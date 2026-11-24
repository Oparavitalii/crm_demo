/**
 * Closed set of API error codes. The single source of truth shared between
 * the Hono backend (`AppError`) and the React frontend (`parseApiError`).
 *
 * Add a code here BEFORE you throw or compare against it — TypeScript will
 * then refuse callers that drift. The `as const` shape gives every value
 * its own literal type so `ERROR_CODES.DUPLICATE` is narrower than `string`.
 */
export const ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH: 'INVALID_REFRESH',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_2FA: 'INVALID_2FA',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  HAS_REFERENCES: 'HAS_REFERENCES',
  VALIDATION: 'VALIDATION',
  ALREADY_CONVERTED: 'ALREADY_CONVERTED',
  ALREADY_ASSIGNED: 'ALREADY_ASSIGNED',
  ALREADY_ACTIVE: 'ALREADY_ACTIVE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  TOO_MANY_RECIPIENTS: 'TOO_MANY_RECIPIENTS',
  SMS_CAP_EXCEEDED: 'SMS_CAP_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Runtime type guard. Useful on the frontend when narrowing
 * `parseApiError().code: string | undefined` down to a known code.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CODES;
}
