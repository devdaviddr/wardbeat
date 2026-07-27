import { z } from 'zod'

/**
 * Centralised, validated environment access.
 *
 * Importing this module fails fast (at boot) with a readable error if a
 * required variable is missing or malformed, instead of surfacing a cryptic
 * `undefined` deep inside a request. Keep this file dependency-free (only
 * `zod`) so it is safe to import from any runtime, including the edge.
 */
/** Treat unset AND empty-string env vars as "not provided". */
const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v))

const envSchema = z
  .object({
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
    AUTH_SECRET: z
      .string()
      .min(1, 'AUTH_SECRET is required — generate one with `npx auth secret`'),
    AUTH_URL: z.string().url().optional(),
    AUTH_TRUST_HOST: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // When true, newly-registered users must verify their email before admin
    // actions are allowed (a soft gate, not a full lockout). Off by default.
    // Only meaningful when email is enabled.
    REQUIRE_EMAIL_VERIFICATION: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    // --- OAuth providers (opt-in) ------------------------------------------
    // Each provider is enabled only when BOTH its id and secret are set (see
    // isGithubConfigured/isGoogleConfigured). Absent → the provider button is
    // hidden and nothing changes for credentials-only deployments.
    AUTH_GITHUB_ID: optionalStr,
    AUTH_GITHUB_SECRET: optionalStr,
    AUTH_GOOGLE_ID: optionalStr,
    AUTH_GOOGLE_SECRET: optionalStr,

    // --- Web Push (opt-in) -------------------------------------------------
    // Generate a keypair with:  npx web-push generate-vapid-keys
    // The feature is inert unless all three are set. VAPID_SUBJECT is a contact
    // URL, typically `mailto:you@example.com`. The public key is safe to expose
    // to the client; the private key is server-only.
    VAPID_PUBLIC_KEY: optionalStr,
    VAPID_PRIVATE_KEY: optionalStr,
    VAPID_SUBJECT: optionalStr,

    // --- Public app URL ----------------------------------------------------
    // Canonical, publicly-reachable origin of this deployment. Used for
    // `metadataBase` (so OpenGraph/Twitter image URLs resolve absolutely) and
    // the robots/sitemap routes. Optional with a dev default so zero-config
    // still boots; set it per fork to the real domain for correct share cards.
    APP_URL: z
      .string()
      .url('APP_URL must be a valid URL')
      .optional()
      .default('http://localhost:3000'),

    // --- Email (opt-in) ---------------------------------------------------
    // Everything email-related is OFF unless EMAIL_ENABLED=true AND a provider
    // (SMTP) is configured. See src/lib/email/. SMTP is provider-agnostic:
    // Resend / SendGrid / Mailgun / SES / Gmail all expose SMTP credentials.
    EMAIL_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    EMAIL_FROM: z
      .string()
      .email('EMAIL_FROM must be a valid email address')
      .optional(),
    SMTP_HOST: optionalStr,
    SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
    SMTP_USER: optionalStr,
    SMTP_PASSWORD: optionalStr,
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    // --- File storage (S3-compatible — MinIO by default) -------------------
    // Required: the docker-compose `minio` service ships working defaults in
    // .env.example, so `cp .env.example .env` works with zero extra setup —
    // same posture as DATABASE_URL.
    S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL'),
    S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
    S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
    S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
    S3_REGION: z.string().min(1).optional().default('us-east-1'),
    UPLOAD_MAX_SIZE_MB: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(10),
    MAX_STORAGE_PER_USER_MB: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(500),
    // Comma-separated MIME allow-list.
    UPLOAD_ALLOWED_MIME_TYPES: z
      .string()
      .min(1)
      .optional()
      .default('image/png,image/jpeg,image/webp,image/gif,application/pdf'),

    // --- WardBeat AI plane (spec v0.2.0) -----------------------------------
    // The internal FastAPI `ai` service does barrier extraction. WARDBEAT_AI_URL
    // is where Next.js (server-side only) reaches it — `http://localhost:8000`
    // in host dev, `http://ai:8000` in the Compose network. The service token is
    // a shared secret the `ai` service requires on every call. The ward board is
    // behind a feature flag (off by default).
    WARDBEAT_AI_URL: z
      .string()
      .url()
      .optional()
      .default('http://localhost:8000'),
    WARDBEAT_AI_SERVICE_TOKEN: optionalStr,
    FEATURE_WARD_BOARD: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    FEATURE_COPILOT: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    FEATURE_ACTIONS: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    // --- Build identity (baked into the image at CI build time) ------------
    // ci.yml passes these as Docker build-args (APP_VERSION=git ref name,
    // APP_GIT_SHA=commit sha); the Dockerfile persists them as ENV. Surfaced
    // read-only in the Settings page. Absent under `next dev` and in un-baked
    // local images — the UI degrades gracefully.
    APP_VERSION: optionalStr,
    APP_GIT_SHA: optionalStr,
  })
  .superRefine((val, ctx) => {
    // If email is toggled on, a provider MUST be configured — fail fast at boot
    // rather than silently dropping mail (or throwing on first send).
    if (!val.EMAIL_ENABLED) return
    const requiredWhenEnabled: Array<[string, unknown]> = [
      ['EMAIL_FROM', val.EMAIL_FROM],
      ['SMTP_HOST', val.SMTP_HOST],
      ['SMTP_PORT', val.SMTP_PORT],
    ]
    for (const [key, value] of requiredWhenEnabled) {
      if (value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when EMAIL_ENABLED=true`,
        })
      }
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  throw new Error(`❌ Invalid environment variables:\n${issues}`)
}

export const env = parsed.data
export type Env = typeof env
