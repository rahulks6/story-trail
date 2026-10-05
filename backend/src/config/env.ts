import * as fs from "node:fs";
import * as path from "node:path";

function loadDotEnvIfPresent(): void {
  // Resolved from the working directory (this package's root), not
  // __dirname, so it finds .env whether running from source (ts-node) or
  // from dist/ (compiled) — both are always invoked with backend/ as cwd.
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const MIN_SECRET_LENGTH = 32;

/**
 * A misconfigured deployment — a short/guessable secret, or the same
 * secret reused for both token types — is a real production risk, not a
 * theoretical one, so this fails fast at startup rather than accepting
 * whatever's in the environment. `AccessTokenClaims`/`RefreshTokenClaims`
 * already carry a `type` discriminator as defense in depth (tokens.ts),
 * but that shouldn't be the only thing standing between a leaked/weak
 * secret and a forged token.
 */
function requireStrongSecret(name: string, value: string): string {
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters. Generate a real one with: ` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

export const config = {
  features: {
    admin: process.env.ADMIN_CONSOLE_ENABLED === "true",
    ads: process.env.ADS_ENABLED === "true",
    sponsored: process.env.SPONSORED_STORIES_ENABLED === "true",
    adReporting: process.env.AD_REPORTING_ENABLED === "true",
  },
  admin: {
    origin: process.env.ADMIN_ORIGIN ?? "http://localhost:4000",
    staticRoot: process.env.ADMIN_STATIC_ROOT ?? path.resolve(process.cwd(), "../admin"),
    // TOTP is mandatory for every admin unless explicitly disabled outside production.
    mfaRequired: process.env.NODE_ENV === "production" || process.env.ADMIN_MFA_REQUIRED !== "false",
    // 32-byte key (hex or base64) that encrypts TOTP secrets at rest.
    mfaEncryptionKey: process.env.ADMIN_MFA_ENCRYPTION_KEY ?? "",
    idleTimeoutMinutes: optionalInt("ADMIN_SESSION_IDLE_MINUTES", 30),
    absoluteTimeoutMinutes: optionalInt("ADMIN_SESSION_ABSOLUTE_MINUTES", 8 * 60),
    recentAuthMinutes: optionalInt("ADMIN_RECENT_AUTH_MINUTES", 5),
  },
  email: {
    // ses (production), log (development only: prints messages), memory (tests), disabled.
    provider: (process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "log")) as "ses" | "log" | "memory" | "disabled" | "",
    from: process.env.EMAIL_FROM ?? "",
    awsRegion: process.env.AWS_REGION ?? "ap-south-1",
  },
  appLinks: {
    // Deep link the reset email opens; the code is appended as a query parameter.
    passwordReset: process.env.PASSWORD_RESET_LINK ?? "katkee://reset-password",
  },
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: optionalInt("PORT", 4000),
  db: {
    host: process.env.PGHOST ?? "localhost",
    port: optionalInt("PGPORT", 5432),
    database: process.env.PGDATABASE ?? "katkee_dev",
    user: process.env.PGUSER ?? "katkee",
    password: process.env.PGPASSWORD ?? "",
  },
  media: {
    // Resolved from cwd (this package's root), matching loadDotEnvIfPresent's
    // reasoning above — __dirname would point into dist/ once compiled.
    // Local disk is for development and tests only; production requires s3.
    storageRoot: process.env.MEDIA_STORAGE_ROOT || path.resolve(process.cwd(), "data", "media"),
    store: (process.env.MEDIA_STORE ?? "local") as "local" | "s3",
    s3: {
      bucket: process.env.MEDIA_S3_BUCKET ?? "",
      region: process.env.AWS_REGION ?? "ap-south-1",
      // Only for S3-compatible test servers; never set in AWS.
      endpoint: process.env.MEDIA_S3_ENDPOINT ?? "",
      forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === "true",
    },
    cdn: {
      // CloudFront distribution (origin access control to the bucket, trusted key group).
      domain: process.env.MEDIA_CDN_DOMAIN ?? "",
      keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID ?? "",
      // PEM, or base64 of the PEM. Supplied by the secret store, never committed.
      privateKey: process.env.CLOUDFRONT_PRIVATE_KEY ?? "",
      urlTtlSeconds: optionalInt("MEDIA_URL_TTL_SECONDS", 3600),
    },
    queue: {
      driver: (process.env.MEDIA_QUEUE ?? "postgres") as "postgres" | "sqs",
      sqsQueueUrl: process.env.MEDIA_SQS_QUEUE_URL ?? "",
      sqsEndpoint: process.env.MEDIA_SQS_ENDPOINT ?? "",
    },
    partSizeBytes: optionalInt("MEDIA_UPLOAD_PART_BYTES", 8 * 1024 * 1024),
    partUrlTtlSeconds: optionalInt("MEDIA_PART_URL_TTL_SECONDS", 3600),
    uploadSessionHours: optionalInt("MEDIA_UPLOAD_SESSION_HOURS", 24),
    uploadsPerHour: optionalInt("MEDIA_UPLOADS_PER_HOUR", 60),
    maxOpenUploads: optionalInt("MEDIA_MAX_OPEN_UPLOADS", 5),
    maxVideoSeconds: optionalInt("MEDIA_MAX_VIDEO_SECONDS", 60),
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
    worker: {
      // Run the processing worker inside the API process (development only).
      inProcess: process.env.MEDIA_WORKER_IN_PROCESS === "true",
      concurrency: optionalInt("MEDIA_WORKER_CONCURRENCY", 1),
      leaseSeconds: optionalInt("MEDIA_JOB_LEASE_SECONDS", 15 * 60),
      pollMs: optionalInt("MEDIA_WORKER_POLL_MS", 5000),
      jobTimeoutSeconds: optionalInt("MEDIA_JOB_TIMEOUT_SECONDS", 10 * 60),
    },
  },
  retention: {
    enabled: process.env.RETENTION_ENABLED !== "false",
    intervalMinutes: optionalInt("RETENTION_INTERVAL_MINUTES", 60),
    batchSize: optionalInt("RETENTION_BATCH_SIZE", 200),
    unusedMediaHours: optionalInt("RETENTION_UNUSED_MEDIA_HOURS", 48),
    deletedStoryDays: optionalInt("RETENTION_DELETED_STORY_DAYS", 30),
    moderationEvidenceDays: optionalInt("RETENTION_MODERATION_EVIDENCE_DAYS", 180),
    deletedAccountDays: optionalInt("RETENTION_DELETED_ACCOUNT_DAYS", 30),
    originalMediaDays: optionalInt("RETENTION_ORIGINAL_MEDIA_DAYS", 30),
    securityEventDays: optionalInt("RETENTION_SECURITY_EVENT_DAYS", 400),
  },
  stories: {
    // Overridable so tests can exercise real expiry without waiting 24h —
    // see test/env.ts. Spec section 29's 24h lifetime is the production default.
    ttlSeconds: optionalInt("STORY_TTL_SECONDS", 60 * 60 * 24),
  },
  jwt: {
    accessSecret: requireStrongSecret("JWT_ACCESS_SECRET", required("JWT_ACCESS_SECRET")),
    refreshSecret: requireStrongSecret("JWT_REFRESH_SECRET", required("JWT_REFRESH_SECRET")),
    accessTtlSeconds: optionalInt("JWT_ACCESS_TTL_SECONDS", 900),
    refreshTtlSeconds: optionalInt("JWT_REFRESH_TTL_SECONDS", 60 * 60 * 24 * 30),
  },
  rateLimit: {
    // In-memory, single-process limiter (see http/rateLimiter.ts) — there's
    // no Redis/shared store in this sandbox, so this resets on restart and
    // doesn't coordinate across instances. Real, effective protection for
    // this single-process deployment; documented as the first thing to
    // swap for a shared store if this ever runs behind a load balancer.
    // Overridable so tests can exercise real limiting without 200 real
    // requests or a real 15-minute wait — see test/env.ts.
    authWindowMs: optionalInt("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000),
    authMax: optionalInt("RATE_LIMIT_AUTH_MAX", 10),
    globalWindowMs: optionalInt("RATE_LIMIT_GLOBAL_WINDOW_MS", 60 * 1000),
    globalMax: optionalInt("RATE_LIMIT_GLOBAL_MAX", 600),
    // Shared (PostgreSQL-backed) per-network budgets, per hour.
    signupPerHour: optionalInt("RATE_LIMIT_SIGNUP_PER_HOUR", 20),
    resetRequestsPerHour: optionalInt("RATE_LIMIT_RESET_REQUESTS_PER_HOUR", 10),
    resetVerifyPerHour: optionalInt("RATE_LIMIT_RESET_VERIFY_PER_HOUR", 20),
    // Admin sign-in attempts per network address per 15 minutes (per-account limits are separate).
    adminLoginPerIp: optionalInt("RATE_LIMIT_ADMIN_LOGIN_PER_IP", 30),
  },
} as const;

if (config.jwt.accessSecret === config.jwt.refreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.");
}

if (!["ses", "log", "memory", "disabled"].includes(config.email.provider)) {
  throw new Error("EMAIL_PROVIDER must be one of ses, log, memory or disabled.");
}
if (config.nodeEnv === "production" && config.email.provider !== "ses") {
  throw new Error("Production requires EMAIL_PROVIDER=ses so password reset and security alerts are delivered.");
}
if (config.email.provider === "ses" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.email.from.replace(/^.*<(.+)>$/, "$1"))) {
  throw new Error("EMAIL_FROM must be a verified sender address when EMAIL_PROVIDER=ses.");
}
if (config.features.admin && !/^([0-9a-f]{64}|[A-Za-z0-9+/]{43}=)$/i.test(config.admin.mfaEncryptionKey)) {
  throw new Error("ADMIN_CONSOLE_ENABLED requires ADMIN_MFA_ENCRYPTION_KEY: 32 random bytes as 64 hex characters or base64. " +
    `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
}

if (!["local", "s3"].includes(config.media.store)) throw new Error("MEDIA_STORE must be local or s3.");
if (!["postgres", "sqs"].includes(config.media.queue.driver)) throw new Error("MEDIA_QUEUE must be postgres or sqs.");
if (config.media.store === "s3" && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.media.s3.bucket)) {
  throw new Error("MEDIA_STORE=s3 requires MEDIA_S3_BUCKET.");
}
if (config.media.queue.driver === "sqs" && !/^https?:\/\//.test(config.media.queue.sqsQueueUrl)) {
  throw new Error("MEDIA_QUEUE=sqs requires MEDIA_SQS_QUEUE_URL.");
}
if (config.media.cdn.domain && (!config.media.cdn.keyPairId || !config.media.cdn.privateKey)) {
  throw new Error("MEDIA_CDN_DOMAIN requires CLOUDFRONT_KEY_PAIR_ID and CLOUDFRONT_PRIVATE_KEY for signed URLs.");
}
if (config.media.store === "s3" && config.media.partSizeBytes < 5 * 1024 * 1024) {
  throw new Error("MEDIA_UPLOAD_PART_BYTES must be at least 5 MiB for S3 multipart uploads.");
}
if (config.nodeEnv === "production") {
  // Local disk is never the production media store, and media is only delivered through the signed CDN.
  if (config.media.store !== "s3") throw new Error("Production requires MEDIA_STORE=s3.");
  if (!config.media.cdn.domain) throw new Error("Production requires MEDIA_CDN_DOMAIN (CloudFront) with signed URLs.");
  if (config.media.s3.endpoint || config.media.queue.sqsEndpoint) throw new Error("MEDIA_S3_ENDPOINT/MEDIA_SQS_ENDPOINT are for local test servers only.");
  if (config.media.worker.inProcess) throw new Error("Run the media worker as its own service in production (MEDIA_WORKER_IN_PROCESS must be unset).");
}

if (config.features.admin && config.nodeEnv === "production") {
  const origin = new URL(config.admin.origin);
  if (origin.protocol !== "https:" || origin.origin !== config.admin.origin) {
    throw new Error("Production Admin Console requires ADMIN_ORIGIN to be an exact HTTPS origin.");
  }
}
