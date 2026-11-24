import { describe, expect, it } from 'vitest';
import { ERROR_CODES, isErrorCode, type ErrorCode } from '@opushr/shared';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors';

describe('ERROR_CODES registry', () => {
  it('every entry has a key that matches its value', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('exposes the codes used across the backend services', () => {
    const required: ErrorCode[] = [
      'VALIDATION',
      'DUPLICATE',
      'NOT_FOUND',
      'FORBIDDEN',
      'UNAUTHORIZED',
      'ALREADY_CONVERTED',
      'ALREADY_ASSIGNED',
      'TOO_MANY_REQUESTS',
      'HAS_REFERENCES',
    ];
    for (const code of required) {
      expect(ERROR_CODES[code]).toBe(code);
    }
  });
});

describe('isErrorCode type guard', () => {
  it('returns true for every value in ERROR_CODES', () => {
    for (const value of Object.values(ERROR_CODES)) {
      expect(isErrorCode(value)).toBe(true);
    }
  });

  it('returns false for unknown strings, null and non-strings', () => {
    expect(isErrorCode('not-a-real-code')).toBe(false);
    expect(isErrorCode('')).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode({})).toBe(false);
  });
});

describe('AppError subclasses use the shared registry', () => {
  it('NotFoundError → NOT_FOUND, status 404', () => {
    const err = new NotFoundError('candidate');
    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(err.status).toBe(404);
    expect(err.meta).toEqual({ entity: 'candidate' });
  });

  it('ForbiddenError → FORBIDDEN, status 403', () => {
    const err = new ForbiddenError('admin only');
    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(err.status).toBe(403);
  });

  it('UnauthorizedError → UNAUTHORIZED, status 401', () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(err.status).toBe(401);
  });

  it('AppError preserves arbitrary registry code and meta', () => {
    const err = new AppError(ERROR_CODES.ALREADY_ASSIGNED, { currentRecruiterId: 'rec-9' }, 409);
    expect(err.code).toBe('ALREADY_ASSIGNED');
    expect(err.status).toBe(409);
    expect(err.meta).toEqual({ currentRecruiterId: 'rec-9' });
  });
});
