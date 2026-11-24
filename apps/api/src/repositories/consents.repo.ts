import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { consents, type Consent, type NewConsent } from '../db/tables/consents';
import {
  consentOptinTokens,
  type ConsentOptinToken,
  type NewConsentOptinToken,
} from '../db/tables/consent-optin-tokens';

export async function findActiveByToken(token: string): Promise<Consent | undefined> {
  return db.query.consents.findFirst({
    where: and(eq(consents.withdrawalToken, token), isNull(consents.withdrawnAt)),
  });
}

export async function markWithdrawn(
  id: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await db
    .update(consents)
    .set({ withdrawnAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent })
    .where(eq(consents.id, id));
}

export async function insertConsent(values: NewConsent): Promise<Consent> {
  const [row] = await db.insert(consents).values(values).returning();
  if (!row) throw new Error('consent insert returned no row');
  return row;
}

// Is there already an ACTIVE (not withdrawn) consent of this type for this
// person? Matched by email OR phone — either identifier proves it's the same
// candidate. Used to make the confirm + manual-create flows idempotent so we
// never stack duplicate consent rows for the same person+channel.
export async function findActiveConsentByType(params: {
  consentType: string;
  email: string | null;
  phone: string | null;
}): Promise<Consent | undefined> {
  const idMatchers = [
    params.email ? eq(consents.candidateEmail, params.email) : undefined,
    params.phone ? eq(consents.candidatePhone, params.phone) : undefined,
  ].filter(Boolean);
  if (idMatchers.length === 0) return undefined;
  return db.query.consents.findFirst({
    where: and(
      eq(consents.consentType, params.consentType),
      isNull(consents.withdrawnAt),
      or(...idMatchers),
    ),
  });
}

// Withdraw EVERY active consent of this type for the person (matched by email
// OR phone). Used when a candidate unticks a channel on the manage page, or an
// admin turns it off. Returns true if anything was withdrawn.
export async function withdrawActiveConsentByType(
  params: { consentType: string; email: string | null; phone: string | null },
  ctx: { ip: string | null; userAgent: string | null },
): Promise<boolean> {
  const idMatchers = [
    params.email ? eq(consents.candidateEmail, params.email) : undefined,
    params.phone ? eq(consents.candidatePhone, params.phone) : undefined,
  ].filter(Boolean);
  if (idMatchers.length === 0) return false;
  const res = await db
    .update(consents)
    .set({ withdrawnAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent })
    .where(
      and(
        eq(consents.consentType, params.consentType),
        isNull(consents.withdrawnAt),
        or(...idMatchers),
      ),
    );
  return (res.rowCount ?? 0) > 0;
}

// -- Re-consent (double opt-in) tokens ------------------------------------

export async function createOptinToken(
  values: NewConsentOptinToken,
): Promise<ConsentOptinToken> {
  const [row] = await db.insert(consentOptinTokens).values(values).returning();
  if (!row) throw new Error('optin token insert returned no row');
  return row;
}

// A token is usable only if it exists, hasn't been consumed, and hasn't
// expired. Same neutral "not found" result for all three cases — a probing
// attacker learns nothing about whether the token was ever real.
export async function findUsableOptinToken(
  token: string,
): Promise<ConsentOptinToken | undefined> {
  return db.query.consentOptinTokens.findFirst({
    where: and(
      eq(consentOptinTokens.token, token),
      isNull(consentOptinTokens.consumedAt),
      gt(consentOptinTokens.expiresAt, new Date()),
    ),
  });
}

export async function markOptinConsumed(id: string): Promise<void> {
  await db
    .update(consentOptinTokens)
    .set({ consumedAt: new Date() })
    .where(eq(consentOptinTokens.id, id));
}
