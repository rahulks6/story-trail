#!/usr/bin/env node
/**
 * Katkee on AWS ap-south-1 (Mumbai). Deploy-time settings come from CDK context (-c key=value or
 * cdk.context.json); nothing secret is passed here. See infra/README.md for the runbook.
 */
import * as fs from "node:fs";
import { App } from "aws-cdk-lib";
import { KatkeeStack, type KatkeeSettings } from "../lib/katkee-stack";

const app = new App();
const get = (key: string): string | undefined => {
  const value = app.node.tryGetContext(key) as unknown;
  return value === undefined || value === null || value === "" ? undefined : String(value);
};
const need = (key: string): string => {
  const value = get(key);
  if (!value) throw new Error(`Missing context "${key}": cdk deploy -c ${key}=... (see infra/README.md)`);
  return value;
};
const list = (key: string): string[] => (get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const providers = new Set(list("providers"));
const features = new Set(list("features"));
for (const name of providers) if (!["fcm", "apns", "phone", "safeBrowsing"].includes(name)) throw new Error(`Unknown provider "${name}"`);
for (const name of features) if (!["ads", "sponsoredStories", "adReporting"].includes(name)) throw new Error(`Unknown feature "${name}"`);

const settings: KatkeeSettings = {
  imageTag: need("imageTag"),
  migrationImageTag: get("migrationImageTag"),
  apiDomainName: need("apiDomainName"),
  apiCertificateArn: need("apiCertificateArn"),
  adminOrigin: get("adminOrigin"),
  adminConsoleEnabled: get("adminConsoleEnabled") === "true",
  adminAllowedCidrs: list("adminAllowedCidrs"),
  emailFrom: need("emailFrom"),
  sesIdentity: need("sesIdentity"),
  // A file (the CLI keeps only the first line of a multi-line -c value), or the PEM in cdk.context.json.
  cloudFrontPublicKeyPem: get("cloudFrontPublicKeyFile") ? fs.readFileSync(need("cloudFrontPublicKeyFile"), "utf8") : need("cloudFrontPublicKeyPem"),
  alarmEmail: need("alarmEmail"),
  monthlyBudgetUsd: Number(get("monthlyBudgetUsd") ?? 500),
  databaseInstanceType: get("databaseInstanceType") ?? "t4g.medium",
  analyticsTimeZone: get("analyticsTimeZone") ?? "Asia/Kolkata",
  providers: {
    fcm: providers.has("fcm"),
    apns: providers.has("apns") ? { bundleId: need("apnsBundleId") } : undefined,
    phone: providers.has("phone") ? { verifyServiceSid: need("twilioVerifyServiceSid"), countries: list("phoneAuthCountries").length ? list("phoneAuthCountries") : ["IN"] } : undefined,
    safeBrowsing: providers.has("safeBrowsing"),
    googleClientIds: list("googleClientIds"),
  },
  features: { ads: features.has("ads"), sponsoredStories: features.has("sponsoredStories"), adReporting: features.has("adReporting") },
  bootstrap: get("bootstrap") === "true",
};

new KatkeeStack(app, "KatkeeProduction", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-south-1" },
  description: "Katkee production: API and worker on ECS Fargate, PostgreSQL on RDS, media on S3 + CloudFront, jobs on SQS",
  terminationProtection: true,
  settings,
});
