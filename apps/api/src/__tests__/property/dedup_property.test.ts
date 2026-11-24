import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeEmail, normalizeName, normalizePhone } from '../../lib/normalize';

// Property tests lock the dedup-sensitive normalization rules in place.
// IMPORTANT: properties are adapted to the REAL rules in lib/normalize.ts:
//   - email: trim + lowercase, empty -> null
//   - phone: trim only (we keep the raw form the candidate typed — no whitespace
//     or paren stripping), empty -> null
//   - name : trim + lowercase, empty -> null
// If you change the helpers, expect these to fail loudly — and update both
// the helper AND the SQL-side comparators in candidates.repo.ts together.

describe('normalizeEmail (property)', () => {
  it('is idempotent: normalize(normalize(x)) === normalize(x)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeEmail(s);
        const twice = normalizeEmail(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('returns null for whitespace-only and empty input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.constant(undefined),
          fc.constantFrom(' ', '   ', '\t', '\n', '\r\n', ' \t '),
        ),
        (s) => {
          expect(normalizeEmail(s as string | null | undefined)).toBeNull();
        },
      ),
    );
  });

  it('output is always lowercase when non-null', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const r = normalizeEmail(email);
        if (r !== null) expect(r).toBe(r.toLowerCase());
      }),
    );
  });

  it('output has no leading or trailing whitespace when non-null', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = normalizeEmail(s);
        if (r !== null) {
          expect(r).toBe(r.trim());
        }
      }),
    );
  });

  it('preserves a real address shape modulo case + surrounding whitespace', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.stringMatching(/^[ \t]*$/),
        fc.stringMatching(/^[ \t]*$/),
        (email, leftWs, rightWs) => {
          const padded = `${leftWs}${email.toUpperCase()}${rightWs}`;
          expect(normalizeEmail(padded)).toBe(email.toLowerCase());
        },
      ),
    );
  });
});

describe('normalizePhone (property)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizePhone(s);
        const twice = normalizePhone(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('returns null for whitespace-only and empty input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.constant(undefined),
          fc.constantFrom(' ', '   ', '\t', '\n', '\r\n'),
        ),
        (s) => {
          expect(normalizePhone(s as string | null | undefined)).toBeNull();
        },
      ),
    );
  });

  it('output has no leading or trailing whitespace when non-null', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (s) => {
        const r = normalizePhone(s);
        if (r !== null) {
          expect(r).toBe(r.trim());
        }
      }),
    );
  });

  it('preserves interior characters (we intentionally keep spaces/parens/hyphens)', () => {
    // The codebase intentionally does NOT strip whitespace/parens/hyphens from
    // phone numbers — they get stored verbatim as the candidate typed them on
    // the form. This property guards against silently changing that behavior.
    fc.assert(
      fc.property(
        fc.constantFrom(
          '+48 123 456 789',
          '(48) 123-456-789',
          '+48-123-456-789',
          '48 123 456 789',
          '123 456 789',
        ),
        (phone) => {
          expect(normalizePhone(phone)).toBe(phone);
          expect(normalizePhone(`  ${phone}  `)).toBe(phone);
        },
      ),
    );
  });
});

describe('normalizeName (property)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeName(s);
        const twice = normalizeName(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('returns null for whitespace-only and empty input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.constant(undefined),
          fc.constantFrom(' ', '   ', '\t', '\n'),
        ),
        (s) => {
          expect(normalizeName(s as string | null | undefined)).toBeNull();
        },
      ),
    );
  });

  it('output is lowercase when non-null', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (s) => {
        const r = normalizeName(s);
        if (r !== null) expect(r).toBe(r.toLowerCase());
      }),
    );
  });

  it('case-insensitive equality holds: different casings normalize to the same key', () => {
    // Locks the "Jan Kowalski" === "jan kowalski" === "JAN KOWALSKI" property
    // that the dedup self-join relies on.
    fc.assert(
      fc.property(
        fc.constantFrom('Jan Kowalski', 'Ivan Petrenko', 'Marina O\'Brien'),
        fc.stringMatching(/^[ \t]*$/),
        fc.stringMatching(/^[ \t]*$/),
        (name, leftWs, rightWs) => {
          const a = normalizeName(`${leftWs}${name}${rightWs}`);
          const b = normalizeName(name.toUpperCase());
          const c = normalizeName(name.toLowerCase());
          expect(a).toBe(b);
          expect(b).toBe(c);
        },
      ),
    );
  });
});

describe('cross-cutting invariants', () => {
  it('all three normalizers return null OR a non-empty string (never empty string)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const fn of [normalizeEmail, normalizePhone, normalizeName]) {
          const r = fn(s);
          expect(r === null || (typeof r === 'string' && r.length > 0)).toBe(true);
        }
      }),
    );
  });

  it('null/undefined input always yields null (independent of normalizer)', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (v) => {
        expect(normalizeEmail(v)).toBeNull();
        expect(normalizePhone(v)).toBeNull();
        expect(normalizeName(v)).toBeNull();
      }),
    );
  });
});
