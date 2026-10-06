/**
 * PostgreSQL connection settings, apart from the rest of the configuration (env.ts) so the
 * migration runner needs nothing but database access: no app secrets, no provider settings.
 * Loads backend/.env (development) before anything reads the environment.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as tls from "node:tls";

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

/**
 * TLS to PostgreSQL, as libpq names it (psql reads the same variables):
 *   PGSSLMODE=disable (default) | require (encrypted, server not verified)
 *            | verify-ca (certificate from a trusted CA) | verify-full (trusted CA and matching host name)
 *   PGSSLROOTCERT=<CA bundle>; for Amazon RDS in Mumbai: certs/rds-ap-south-1-bundle.pem.
 */
export function databaseTls(env: NodeJS.ProcessEnv = process.env): false | {
  rejectUnauthorized: boolean;
  ca?: string;
  checkServerIdentity?: (servername: string, cert: tls.PeerCertificate) => Error | undefined;
} {
  const mode = env.PGSSLMODE ?? "disable";
  if (!["disable", "require", "verify-ca", "verify-full"].includes(mode)) {
    throw new Error("PGSSLMODE must be disable, require, verify-ca or verify-full.");
  }
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  const ca = env.PGSSLROOTCERT ? { ca: fs.readFileSync(env.PGSSLROOTCERT, "utf8") } : {};
  if (mode === "verify-ca") return { rejectUnauthorized: true, ...ca, checkServerIdentity: () => undefined };
  // The certificate must name the configured host. node-postgres sends no TLS server name for an
  // IP address, and Node would then check the certificate against "localhost" instead.
  const host = env.PGHOST ?? "localhost";
  return { rejectUnauthorized: true, ...ca, checkServerIdentity: (_servername, cert) => tls.checkServerIdentity(host, cert) };
}

function port(): number {
  const value = process.env.PGPORT;
  if (!value) return 5432;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable PGPORT must be an integer, got: ${value}`);
  }
  return parsed;
}

export const database = {
  ssl: databaseTls(),
  host: process.env.PGHOST ?? "localhost",
  port: port(),
  database: process.env.PGDATABASE ?? "katkee_dev",
  user: process.env.PGUSER ?? "katkee",
  password: process.env.PGPASSWORD ?? "",
};
