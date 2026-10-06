import * as fs from "node:fs";
import * as path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { KatkeeStack, type KatkeeSettings } from "../lib/katkee-stack";

/** The same feature flags the CLI applies (cdk.json), so tests synthesize what a deploy would. */
const cdkContext = (JSON.parse(fs.readFileSync(path.join(__dirname, "../../cdk.json"), "utf8")) as { context: Record<string, unknown> }).context;

export const cloudFrontKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const publicPem = cloudFrontKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

export function settings(overrides: Partial<KatkeeSettings> = {}): KatkeeSettings {
  return {
    imageTag: "3f9c2a1b",
    apiDomainName: "api.katkee.example",
    apiCertificateArn: "arn:aws:acm:ap-south-1:123456789012:certificate/0f0e0d0c-1111-2222-3333-444455556666",
    adminConsoleEnabled: true,
    emailFrom: "Katkee <no-reply@katkee.example>",
    sesIdentity: "katkee.example",
    cloudFrontPublicKeyPem: publicPem,
    alarmEmail: "ops@katkee.example",
    monthlyBudgetUsd: 500,
    databaseInstanceType: "t4g.medium",
    analyticsTimeZone: "Asia/Kolkata",
    providers: { fcm: false, safeBrowsing: false, googleClientIds: [] },
    features: { ads: false, sponsoredStories: false, adReporting: false },
    bootstrap: false,
    ...overrides,
  };
}

/** Every provider and the Admin console on: the widest configuration. */
export const everything = (): KatkeeSettings => settings({
  adminAllowedCidrs: ["203.0.113.0/24"],
  providers: {
    fcm: true,
    apns: { bundleId: "app.katkee" },
    phone: { verifyServiceSid: "VA0123456789abcdef0123456789abcdef", countries: ["IN"] },
    safeBrowsing: true,
    googleClientIds: ["1234-abc.apps.googleusercontent.com"],
  },
});

export function synth(s: KatkeeSettings = settings()): { stack: KatkeeStack; template: Template } {
  const app = new App({ context: cdkContext });
  const stack = new KatkeeStack(app, "KatkeeProduction", { env: { account: "123456789012", region: "ap-south-1" }, settings: s });
  return { stack, template: Template.fromStack(stack) };
}

type Resource = { Type: string; Properties: Record<string, any>; DeletionPolicy?: string; UpdateReplacePolicy?: string };

export function resources(template: Template, type: string): Array<[string, Resource]> {
  return Object.entries(template.findResources(type)) as Array<[string, Resource]>;
}

export function only(template: Template, type: string, match: (id: string, r: Resource) => boolean = () => true): [string, Resource] {
  const found = resources(template, type).filter(([id, r]) => match(id, r));
  if (found.length !== 1) throw new Error(`expected one ${type}, found ${found.length}`);
  return found[0]!;
}

export type Container = { Name: string; Environment?: Array<{ Name: string; Value: unknown }>; Secrets?: Array<{ Name: string; ValueFrom: unknown }>; [key: string]: any };

export function container(template: Template, name: string): Container {
  for (const [, task] of resources(template, "AWS::ECS::TaskDefinition")) {
    const found = (task.Properties.ContainerDefinitions as Container[]).find((c) => c.Name === name);
    if (found) return found;
  }
  throw new Error(`no container ${name}`);
}

export const envOf = (c: Container) => Object.fromEntries((c.Environment ?? []).map((e) => [e.Name, e.Value]));
export const secretNames = (c: Container) => (c.Secrets ?? []).map((s) => s.Name).sort();

/** The logical ID a { Ref } or { Fn::GetAtt } points at. */
export function refTo(value: unknown): string | undefined {
  const v = value as { Ref?: string; "Fn::GetAtt"?: [string, string] } | undefined;
  return v?.Ref ?? v?.["Fn::GetAtt"]?.[0];
}

/** IAM statements of the policies attached to a role (by its logical ID). */
export function statementsFor(template: Template, roleId: string): Array<{ Sid?: string; Action: string | string[]; Resource: unknown; Effect: string }> {
  return resources(template, "AWS::IAM::Policy")
    .filter(([, p]) => (p.Properties.Roles as unknown[]).some((r) => refTo(r) === roleId))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
}

export const actions = (s: { Action: string | string[] }) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
