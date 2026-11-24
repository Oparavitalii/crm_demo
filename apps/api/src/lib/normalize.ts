// Pure normalization helpers for dedup-sensitive fields.
//
// These rules MUST match what the SQL-side comparators do in
// `repositories/candidates.repo.ts` (findDuplicates / findFirstMatchingCandidate
// / findDuplicateIds), otherwise the JS layer disagrees with the DB and the
// dedup tagger drifts. Property tests in `src/__tests__/property/` lock the
// shape — don't change rules here without updating both the SQL and the tests.
//
// Email: `lower(trim(email))` — Postgres `lower()` matches `String.toLowerCase`
//        for ASCII, which is all our addresses currently are. Empty -> null.
// Phone: `trim(phone)` — phones are stored verbatim (we don't strip spaces or
//        parens; admins enter them as the candidate typed them on the form).
//        Empty -> null.
// Name:  `lower(trim(name))` — used as the comparison key in matchedFields and
//        the SQL self-join. Empty input is never passed here (name is NOT NULL
//        in DB and required by all the Zod schemas), but we still defend with
//        empty -> null for the property tests.

export function normalizeEmail(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function normalizePhone(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function normalizeName(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}
