import { generateSecret, generateURI, verifySync } from 'otplib';

const PERIOD = 30;
// ±1 step (30s) clock drift tolerance
const EPOCH_TOLERANCE = PERIOD;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function getTotpUri(email: string, secret: string): string {
  return generateURI({
    secret,
    label: email,
    issuer: 'CRM Demo',
    strategy: 'totp',
    period: PERIOD,
  });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret, strategy: 'totp', period: PERIOD, epochTolerance: EPOCH_TOLERANCE });
    return result.valid;
  } catch {
    return false;
  }
}
