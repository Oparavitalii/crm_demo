// Public withdraw-consent flow. RODO art. 7 ust. 3 — withdrawing consent must
// be as easy as giving it. The candidate clicks a link in any email we sent
// them (footer carries `${APP_URL}/withdraw/${withdrawalToken}`); the public
// route below validates the token, marks the consent withdrawn, and
// anonymizes the linked candidate row in the same call.
import {
  CONSENT_SOURCES,
  CONSENT_TYPES,
  CONSENT_VERSIONS,
  type ConsentChannel,
} from '@crm/shared';
import * as consentsRepo from '../repositories/consents.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as audit from './audit.service';
import { anonymizeCandidate } from './anonymize.service';
import { AppError } from '../lib/errors';

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

// Synthetic actor — withdraw is anonymous from the API's perspective. The
// audit row keeps actorId null but records the originating IP and a marker.
const PUBLIC_SELF_ACTOR = {
  id: '00000000-0000-0000-0000-000000000000',
  role: 'admin' as const,
};

export interface WithdrawResult {
  withdrawn: boolean;
  anonymized: boolean;
}

export async function withdrawConsent(
  token: string,
  ctx: ReqCtx,
): Promise<WithdrawResult> {
  const consent = await consentsRepo.findActiveByToken(token);
  // Same response for "token doesn't exist" and "already withdrawn" — no
  // signal back to a probing attacker about whether the token was ever real.
  if (!consent) {
    throw new AppError('INVALID_TOKEN', undefined, 400);
  }

  await consentsRepo.markWithdrawn(consent.id, ctx);
  await audit.log({
    actorId: null,
    action: 'withdraw_consent',
    entityType: 'consent',
    entityId: consent.id,
    newValue: {
      // RODO: do NOT echo the email. Boolean marker only.
      hadEmail: true,
      consentType: consent.consentType,
      version: consent.version,
    },
    ...ctx,
  });

  // If there's a CRM row tied to this email, anonymize it too. Candidate may
  // not yet exist (consent was given but lead never created) — that's fine.
  // Phone-only sms_marketing consents have no email to anonymize by; the token
  // withdraw link is only ever mailed for email-carrying consents anyway.
  if (!consent.candidateEmail) {
    return { withdrawn: true, anonymized: false };
  }
  const candidate = await candidatesRepo.findActiveByEmailCi(consent.candidateEmail);
  if (!candidate) {
    return { withdrawn: true, anonymized: false };
  }
  const res = await anonymizeCandidate(candidate.id, PUBLIC_SELF_ACTOR, ctx);
  return { withdrawn: true, anonymized: !res.alreadyAnonymized };
}

// ---------------------------------------------------------------------------
// Re-consent (double opt-in) — the mirror of withdraw. A "consent campaign"
// email carries `${APP_URL}/consent/confirm/${token}`; the candidate clicks it,
// picks the channel(s), and confirms. Each requested-and-available channel
// becomes an ACTIVE consent row (source='re_consent_email'), with the click's
// ip + userAgent + timestamp as RODO art. 7 evidence. Then the token is spent.
// ---------------------------------------------------------------------------

export interface OptinTokenInfo {
  hasEmail: boolean;
  hasPhone: boolean;
  emailConsent: boolean;
  smsConsent: boolean;
}

// Current active marketing-consent state for an email/phone pair.
async function currentState(
  email: string | null,
  phone: string | null,
): Promise<{ email: boolean; sms: boolean }> {
  const [emailC, smsC] = await Promise.all([
    email
      ? consentsRepo.findActiveConsentByType({
          consentType: CONSENT_TYPES.emailMarketing,
          email,
          phone: null,
        })
      : Promise.resolve(undefined),
    email || phone
      ? consentsRepo.findActiveConsentByType({
          consentType: CONSENT_TYPES.smsMarketing,
          email,
          phone,
        })
      : Promise.resolve(undefined),
  ]);
  return { email: Boolean(emailC), sms: Boolean(smsC) };
}

export async function getOptinTokenInfo(token: string): Promise<OptinTokenInfo> {
  const row = await consentsRepo.findUsableOptinToken(token);
  // Neutral 400 for missing / expired — no enumeration signal.
  if (!row) throw new AppError('INVALID_TOKEN', undefined, 400);
  const state = await currentState(row.candidateEmail, row.candidatePhone);
  return {
    hasEmail: row.candidateEmail !== null,
    hasPhone: row.candidatePhone !== null,
    emailConsent: state.email,
    smsConsent: state.sms,
  };
}

export interface ConfirmResult {
  confirmed: boolean;
  channels: ConsentChannel[];
}

// Preference-center SET. `channels` is the desired ON set: an applicable channel
// present → ensured active, absent → withdrawn. Empty = turn everything off. The
// token is NOT consumed, so the manage link keeps working until it expires.
export async function confirmConsent(
  token: string,
  channels: ConsentChannel[],
  ctx: ReqCtx,
): Promise<ConfirmResult> {
  const tok = await consentsRepo.findUsableOptinToken(token);
  if (!tok) throw new AppError('INVALID_TOKEN', undefined, 400);

  const want = new Set(channels);

  // EMAIL — only meaningful if there's an email on file.
  if (tok.candidateEmail) {
    if (want.has('email')) {
      await ensureActiveConsent(
        { consentType: CONSENT_TYPES.emailMarketing, version: CONSENT_VERSIONS.emailMarketing },
        { email: tok.candidateEmail, phone: null },
        ctx,
      );
    } else {
      await consentsRepo.withdrawActiveConsentByType(
        { consentType: CONSENT_TYPES.emailMarketing, email: tok.candidateEmail, phone: null },
        ctx,
      );
    }
  }

  // SMS — identity is the phone (legacy email-keyed rows also honored).
  if (tok.candidatePhone || tok.candidateEmail) {
    if (want.has('sms')) {
      await ensureActiveConsent(
        { consentType: CONSENT_TYPES.smsMarketing, version: CONSENT_VERSIONS.smsMarketing },
        { email: tok.candidateEmail, phone: tok.candidatePhone },
        ctx,
      );
    } else {
      await consentsRepo.withdrawActiveConsentByType(
        { consentType: CONSENT_TYPES.smsMarketing, email: tok.candidateEmail, phone: tok.candidatePhone },
        ctx,
      );
    }
  }

  const state = await currentState(tok.candidateEmail, tok.candidatePhone);
  const active: ConsentChannel[] = [
    ...(state.email ? (['email'] as const) : []),
    ...(state.sms ? (['sms'] as const) : []),
  ];

  await audit.log({
    actorId: null,
    action: 'confirm_consent',
    entityType: 'candidate',
    entityId: tok.candidateId,
    newValue: {
      // RODO: booleans + channels, never the raw email/phone.
      channels: active,
      hadEmail: tok.candidateEmail !== null,
      hadPhone: tok.candidatePhone !== null,
      source: CONSENT_SOURCES.reConsentEmail,
    },
    ...ctx,
  });

  return { confirmed: active.length > 0, channels: active };
}

// Insert an active consent row unless one already exists (idempotent) — a
// double-click on the confirm link must not stack duplicate rows.
async function ensureActiveConsent(
  kind: { consentType: string; version: string },
  ids: { email: string | null; phone: string | null },
  ctx: ReqCtx,
): Promise<void> {
  const existing = await consentsRepo.findActiveConsentByType({
    consentType: kind.consentType,
    email: ids.email,
    phone: ids.phone,
  });
  if (existing) return;
  await consentsRepo.insertConsent({
    candidateEmail: ids.email,
    candidatePhone: ids.phone,
    consentType: kind.consentType,
    version: kind.version,
    source: CONSENT_SOURCES.reConsentEmail,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
