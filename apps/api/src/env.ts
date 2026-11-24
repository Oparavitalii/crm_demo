import 'dotenv/config';
import { z } from 'zod';

// z.coerce.boolean() is a footgun for env vars: it does Boolean(input), so ANY
// non-empty string — including "false" and "0" — coerces to `true`. That made
// SMS_TEST_MODE=false parse as `true`, silently keeping production in test mode
// (every send returned a fake msgId, nothing delivered). Parse booleans by
// their string value instead.
const envBool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()),
    )
    .default(def);

// Every secret here reaches the process by being pasted into a web form —
// Fly's secrets UI or GitHub Actions'. On 2026-07-30 four separate values
// arrived with a trailing newline and each produced a different, unhelpful
// failure six steps downstream:
//
//   BACKUP_ENCRYPTION_KEY  -> Zod said only "Invalid"
//   DATABASE_URL_DIRECT    -> pg_dump: invalid sslmode value: "require\n\n"
//   R2_ACCESS_KEY          -> ERR_INVALID_CHAR on the Authorization header
//   R2_BUCKET              -> S3 InvalidBucketName, HTTP 400
//
// Six backup runs died on an invisible character, and not one message named
// it. None of these values can legitimately start or end with whitespace, so
// trimming costs nothing and removes the whole class.
//
// z.preprocess rather than .transform() so the trim happens BEFORE .url() /
// .regex() / .min() see the value — otherwise `.url()` passes (the WHATWG URL
// parser strips trailing control characters itself) while the raw string
// keeps the newline and hands it to pg_dump anyway. That is exactly how
// DATABASE_URL_DIRECT slipped through.
const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.preprocess(trim, z.string().url()),
  DATABASE_URL_DIRECT: z.preprocess(trim, z.string().url()),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  RESEND_API_KEY: z.string().startsWith('re_').optional(),

  // SMSAPI.pl — OAuth bearer token from https://ssl.smsapi.pl/react/oauth/manage
  SMSAPI_TOKEN: z.string().optional(),
  // Pre-registered sender name in SMSAPI panel (max 11 chars).
  // Default "Test" works without verification but flags the SMS as test traffic.
  // Production should use the verified brand sender (e.g. "OPUSHR").
  SMSAPI_SENDER: z.string().max(11).default('Test'),
  // Global kill-switch. When `false`, every send attempt short-circuits with a
  // logged warning and returns null — useful for incidents and for keeping the
  // feature dark on staging while DPA with SMSAPI is being signed.
  SMS_ENABLED: envBool(false),
  // When `true`, requests are sent with `test=1` so SMSAPI validates the
  // payload and returns a realistic response WITHOUT charging or delivering.
  // Defaults to `true` on dev/staging to make accidental real-send impossible.
  SMS_TEST_MODE: envBool(true),
  // Hard cap on outbound SMS per calendar day. Enforced in bulk-send service
  // BEFORE any provider call. Override per environment as needed.
  SMS_DAILY_CAP: z.coerce.number().int().positive().default(200),

  // Global kill-switch for the onboarding/welcome auto-send email. When `false`
  // (default), no welcome email is auto-sent on candidate creation even if a
  // template is flagged auto-send — keeps the flow dark until the consent
  // wording is approved by legal. Flip to `true` to enable in production.
  ONBOARDING_AUTOSEND_ENABLED: envBool(false),

  R2_ENDPOINT: z.preprocess(trim, z.string().url()),
  R2_ACCESS_KEY: z.preprocess(trim, z.string().min(1)),
  R2_SECRET_KEY: z.preprocess(trim, z.string().min(1)),
  R2_BUCKET: z.preprocess(trim, z.string().min(1)),
  R2_REGION: z.preprocess(trim, z.string().default('auto')),

  SENTRY_DSN_API: z.string().optional(),
  // 64 hex chars = the 32 bytes AES-256-GCM needs. This value is pasted by
  // hand into two web forms (Fly secrets, GitHub Actions secrets), so it is
  // normalized before validation: a trailing newline and upper-case hex are
  // both common paste artifacts and neither changes the key. Before
  // 2026-07-30 they failed the bare `.regex()` and Zod reported only
  // "Invalid", which does not say whether the length, the case or a stray
  // space was at fault — two backup runs were lost to guessing.
  //
  // The refine message reports the LENGTH and whether non-hex characters are
  // present. Never the value: this is the key that makes every backup
  // readable.
  BACKUP_ENCRYPTION_KEY: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => /^[0-9a-f]{64}$/.test(v), (v) => ({
      message:
        `must be 64 hex characters (32 bytes for AES-256); got ${v.length}` +
        (/^[0-9a-f]*$/.test(v) ? '' : ' and non-hex character(s)'),
    }))
    .optional(),
  // Comma-separated list of allowed origins. e.g. "https://crm.opus-demo.example,https://www.opus-demo.example"
  // CRM frontend + marketing site (for /public/leads form submissions).
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  EMAIL_FROM: z.string().email().default('onboarding@resend.dev'),
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Shared secret used to authenticate Make.com webhook posts to /public/leads.
  // Set in Fly secrets; Make sends it as `Authorization: Bearer <secret>`.
  MAKE_WEBHOOK_SECRET: z.string().min(32).optional(),

  // Svix-format signing secret for Resend webhooks (delivered / opened / bounced /
  // complained). Optional so dev + tests don't blow up — when unset, the webhook
  // route returns 503 instead of silently accepting unsigned payloads. Configured
  // in the Resend dashboard after creating an endpoint; mirror to Fly secrets.
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Public demo. When `true`: e-mail / SMS / object storage never leave the
  // process (see clients/*), account-security endpoints are blocked for the
  // shared guest login (demo/guard.ts), and the cron worker re-seeds the demo
  // data nightly (demo/reset.ts). Never set it on a real deployment.
  DEMO_MODE: envBool(false),
  DEMO_USER_EMAIL: z.preprocess(trim, z.string().email()).default('demo@opus-demo.example'),
  DEMO_USER_PASSWORD: z.string().min(8).default('demo-opus-2026'),
});

// In demo mode there is no object storage, so the R2 settings a real
// deployment must provide get inert placeholders instead of failing boot.
// Explicit values in the environment still win.
const DEMO_R2_PLACEHOLDERS = {
  R2_ENDPOINT: 'http://storage.invalid',
  R2_ACCESS_KEY: 'demo',
  R2_SECRET_KEY: 'demo',
  R2_BUCKET: 'demo',
};
const isDemo = envBool(false).parse(process.env['DEMO_MODE']);
const source = isDemo ? { ...DEMO_R2_PLACEHOLDERS, ...process.env } : process.env;

const parsed = envSchema.safeParse(source);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
