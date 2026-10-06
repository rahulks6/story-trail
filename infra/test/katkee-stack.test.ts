// The production stack's security and reliability properties, asserted on the synthesized
// CloudFormation template (what `cdk deploy` would create in ap-south-1).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Match } from "aws-cdk-lib/assertions";
import { PROVIDER_CREDENTIALS, RDS_CA_BUNDLE, SECRET_PREFIX } from "../lib/katkee-stack";
import { actions, container, envOf, everything, only, refTo, resources, secretNames, settings, statementsFor, synth } from "./helpers";

const { stack, template } = synth(everything());
const json = JSON.stringify(template.toJSON());

describe("placement", () => {
  it("is in Mumbai, tagged, and protected from deletion", () => {
    assert.equal(stack.region, "ap-south-1");
    assert.equal(stack.terminationProtection, false, "set by bin/katkee.ts for the real stack");
    for (const [, bucket] of resources(template, "AWS::S3::Bucket")) {
      assert.deepEqual(bucket.Properties.Tags.filter((t: { Key: string }) => ["app", "environment"].includes(t.Key)),
        [{ Key: "app", Value: "katkee" }, { Key: "environment", Value: "production" }]);
    }
  });

  it("keeps the database in isolated subnets, tasks in private subnets, and only the load balancer public", () => {
    const [, subnetGroup] = only(template, "AWS::RDS::DBSubnetGroup");
    const isolated = (subnetGroup.Properties.SubnetIds as unknown[]).map(refTo);
    for (const id of isolated) assert.match(id!, /^VpcdataSubnet/);
    for (const [, service] of resources(template, "AWS::ECS::Service")) {
      const network = service.Properties.NetworkConfiguration.AwsvpcConfiguration;
      assert.equal(network.AssignPublicIp, "DISABLED");
      for (const id of (network.Subnets as unknown[]).map(refTo)) assert.match(id!, /^VpcappSubnet/);
    }
    const [, alb] = only(template, "AWS::ElasticLoadBalancingV2::LoadBalancer");
    assert.equal(alb.Properties.Scheme, "internet-facing");
    for (const id of (alb.Properties.Subnets as unknown[]).map(refTo)) assert.match(id!, /^VpcpublicSubnet/);
    template.resourceCountIs("Custom::VpcRestrictDefaultSG", 1);
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", { VpcEndpointType: "Gateway", ServiceName: Match.objectLike({ "Fn::Join": Match.anyValue() }) });
  });

  it("lets only the load balancer reach the API, and only the services reach the database", () => {
    const ingress = resources(template, "AWS::EC2::SecurityGroupIngress").map(([, r]) => r.Properties);
    const toDb = ingress.filter((r) => r.FromPort === 5432);
    assert.equal(toDb.length, 2);
    assert.deepEqual(toDb.map((r) => refTo(r.SourceSecurityGroupId)).sort(), [only(template, "AWS::EC2::SecurityGroup", (id) => id.startsWith("ApiSg"))[0], only(template, "AWS::EC2::SecurityGroup", (id) => id.startsWith("WorkerSg"))[0]].sort());
    const toApi = ingress.filter((r) => r.FromPort === 4000);
    assert.equal(toApi.length, 1);
    assert.match(refTo(toApi[0]!.SourceSecurityGroupId)!, /^LoadBalancerSg/);
    const [, dbSg] = only(template, "AWS::EC2::SecurityGroup", (id) => id.startsWith("DatabaseSg"));
    assert.equal(dbSg.Properties.SecurityGroupIngress, undefined, "no CIDR-based access to the database");
  });
});

describe("data at rest and in transit", () => {
  it("runs PostgreSQL 16 Multi-AZ, encrypted, TLS-only, not public, with point-in-time recovery", () => {
    const [, db] = only(template, "AWS::RDS::DBInstance");
    const p = db.Properties;
    assert.match(p.EngineVersion, /^16\./);
    assert.equal(p.MultiAZ, true);
    assert.equal(p.StorageEncrypted, true);
    assert.ok(refTo(p.KmsKeyId)?.startsWith("DataKey"));
    assert.equal(p.PubliclyAccessible, false);
    assert.equal(p.DeletionProtection, true);
    assert.ok(p.BackupRetentionPeriod >= 14);
    assert.equal(p.CACertificateIdentifier, "rds-ca-rsa2048-g1");
    assert.equal(db.DeletionPolicy, "Snapshot");
    const [, params] = only(template, "AWS::RDS::DBParameterGroup");
    assert.equal(params.Properties.Parameters["rds.force_ssl"], "1");
    assert.equal(params.Properties.Parameters.log_min_error_statement, "panic", "no statement text (user content) in logs");
    assert.equal(params.Properties.Parameters.log_min_duration_statement, undefined);
  });

  it("keeps media private: no public access, TLS only, versioned, delivered through CloudFront signed URLs", () => {
    const [mediaId, media] = only(template, "AWS::S3::Bucket", (id) => id.startsWith("MediaBucket"));
    assert.deepEqual(media.Properties.PublicAccessBlockConfiguration, { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
    assert.equal(media.Properties.VersioningConfiguration.Status, "Enabled");
    assert.ok(media.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm);
    assert.ok(media.Properties.LoggingConfiguration.DestinationBucketName);
    assert.ok(media.Properties.LifecycleConfiguration.Rules.some((r: any) => r.AbortIncompleteMultipartUpload?.DaysAfterInitiation === 2));
    const [, policy] = only(template, "AWS::S3::BucketPolicy", (_id, r) => refTo(r.Properties.Bucket) === mediaId);
    const statements = policy.Properties.PolicyDocument.Statement;
    assert.ok(statements.some((s: any) => s.Effect === "Deny" && s.Condition?.Bool?.["aws:SecureTransport"] === "false"));
    const cdnRead = statements.find((s: any) => s.Principal?.Service === "cloudfront.amazonaws.com");
    assert.deepEqual(actions(cdnRead), ["s3:GetObject"]);
    assert.ok(cdnRead.Condition.StringEquals["AWS:SourceArn"], "only this distribution");
    assert.ok(!statements.some((s: any) => s.Principal === "*" && s.Effect === "Allow"), "no public grants");

    const [, cdn] = only(template, "AWS::CloudFront::Distribution");
    const behavior = cdn.Properties.DistributionConfig.DefaultCacheBehavior;
    assert.equal(behavior.ViewerProtocolPolicy, "https-only");
    assert.deepEqual(behavior.AllowedMethods, ["GET", "HEAD"]);
    assert.equal(behavior.TrustedKeyGroups.length, 1, "signed URLs required");
    assert.ok(cdn.Properties.DistributionConfig.Origins[0].OriginAccessControlId, "origin access control, not a public origin");
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  });

  it("encrypts queues, keeps a dead-letter queue, and refuses plain HTTP to them", () => {
    const [dlqId] = only(template, "AWS::SQS::Queue", (id) => id.startsWith("MediaJobsDlq"));
    const [, jobs] = only(template, "AWS::SQS::Queue", (id) => id.startsWith("MediaJobs") && !id.startsWith("MediaJobsDlq"));
    assert.equal(jobs.Properties.RedrivePolicy.maxReceiveCount, 5);
    assert.equal(refTo(jobs.Properties.RedrivePolicy.deadLetterTargetArn), dlqId);
    assert.equal(jobs.Properties.VisibilityTimeout, 900);
    for (const [, q] of resources(template, "AWS::SQS::Queue")) assert.equal(q.Properties.SqsManagedSseEnabled, true);
    for (const [, p] of resources(template, "AWS::SQS::QueuePolicy")) {
      assert.ok(p.Properties.PolicyDocument.Statement.some((s: any) => s.Effect === "Deny" && s.Condition?.Bool?.["aws:SecureTransport"] === "false"));
    }
  });

  it("encrypts every secret with the stack's key, keeps them on deletion, and puts no secret value in the template", () => {
    const secrets = resources(template, "AWS::SecretsManager::Secret");
    for (const [id, s] of secrets) {
      assert.ok(refTo(s.Properties.KmsKeyId)?.startsWith("DataKey"), id);
      assert.equal(s.DeletionPolicy, "Retain", id);
      assert.equal(s.Properties.SecretString, undefined, `${id} has a value in the template`);
      assert.ok(String(s.Properties.Name).startsWith(SECRET_PREFIX), id);
    }
    // Provider credentials start as random placeholders, never usable values.
    for (const name of Object.values(PROVIDER_CREDENTIALS).flat()) {
      const [, s] = only(template, "AWS::SecretsManager::Secret", (_id, r) => r.Properties.Name === `${SECRET_PREFIX}${name}`);
      assert.deepEqual(s.Properties.GenerateSecretString, {}, name);
    }
    assert.doesNotMatch(json, /BEGIN (RSA |EC )?PRIVATE KEY/);
  });

  it("verifies the database certificate and passes no credential as a plain environment value", () => {
    for (const name of ["api", "worker", "migrate"]) {
      const env = envOf(container(template, name));
      assert.equal(env.PGSSLMODE, "verify-full", name);
      assert.equal(env.PGSSLROOTCERT, RDS_CA_BUNDLE, name);
      assert.equal(env.NODE_ENV, "production", name);
      for (const key of Object.keys(env)) assert.doesNotMatch(key, /PASSWORD|SECRET|PRIVATE_KEY|TOKEN|_JSON$|API_KEY/, `${name}: ${key} must come from Secrets Manager`);
    }
  });
});

describe("services", () => {
  it("serves HTTPS only, with a modern TLS policy, and redirects HTTP", () => {
    const listeners = resources(template, "AWS::ElasticLoadBalancingV2::Listener").map(([, l]) => l.Properties);
    const https = listeners.find((l) => l.Port === 443)!;
    assert.equal(https.Protocol, "HTTPS");
    assert.equal(https.SslPolicy, "ELBSecurityPolicy-TLS13-1-2-2021-06");
    const http = listeners.find((l) => l.Port === 80)!;
    assert.deepEqual(http.DefaultActions[0].RedirectConfig, { Port: "443", Protocol: "HTTPS", StatusCode: "HTTP_301" });
    const [, alb] = only(template, "AWS::ElasticLoadBalancingV2::LoadBalancer");
    const attrs = Object.fromEntries((alb.Properties.LoadBalancerAttributes as Array<{ Key: string; Value: string }>).map((a) => [a.Key, a.Value]));
    assert.equal(attrs["idle_timeout.timeout_seconds"], "120", "above the realtime socket's 30 s ping");
    assert.equal(attrs["routing.http.drop_invalid_header_fields.enabled"], "true");
    assert.equal(attrs["deletion_protection.enabled"], "true");
    assert.equal(attrs["access_logs.s3.enabled"], "true");
  });

  it("routes only to tasks that are ready, and drains them on deploys", () => {
    const [, tg] = only(template, "AWS::ElasticLoadBalancingV2::TargetGroup");
    assert.equal(tg.Properties.HealthCheckPath, "/ready");
    assert.equal(tg.Properties.UnhealthyThresholdCount, 10, "rides out a Multi-AZ failover");
    assert.equal(tg.Properties.TargetType, "ip");
    const attrs = Object.fromEntries((tg.Properties.TargetGroupAttributes as Array<{ Key: string; Value: string }>).map((a) => [a.Key, a.Value]));
    assert.equal(attrs["deregistration_delay.timeout_seconds"], "20");
    const api = container(template, "api");
    assert.ok(api.StopTimeout >= 25, "longer than the API's 3 s drain + 20 s in-flight wait");
  });

  it("rolls back failed deploys, keeps capacity during them, and lets autoscaling own the task count", () => {
    for (const [id, service] of resources(template, "AWS::ECS::Service")) {
      const p = service.Properties;
      assert.deepEqual(p.DeploymentConfiguration.DeploymentCircuitBreaker, { Enable: true, Rollback: true }, id);
      assert.equal(p.DeploymentConfiguration.MinimumHealthyPercent, 100, id);
      assert.equal(p.DesiredCount, undefined, `${id}: a deploy must not reset the scaled count`);
    }
    const mins = resources(template, "AWS::ApplicationAutoScaling::ScalableTarget").map(([, t]) => t.Properties.MinCapacity).sort();
    assert.deepEqual(mins, [1, 2]);
  });

  it("runs every container on a read-only root file system with a scratch /tmp", () => {
    for (const name of ["api", "worker", "migrate"]) {
      const c = container(template, name);
      assert.equal(c.ReadonlyRootFilesystem, true, name);
      assert.deepEqual(c.MountPoints, [{ ContainerPath: "/tmp", ReadOnly: false, SourceVolume: "tmp" }], name);
    }
    const worker = container(template, "worker");
    assert.deepEqual(worker.HealthCheck.Command.slice(0, 2), ["CMD", "node"]);
    assert.equal(envOf(worker).WORKER_HEARTBEAT_FILE, "/tmp/katkee-worker-heartbeat");
  });

  it("pulls immutable, scanned images", () => {
    for (const [, repo] of resources(template, "AWS::ECR::Repository")) {
      assert.equal(repo.Properties.ImageTagMutability, "IMMUTABLE");
      assert.equal(repo.Properties.ImageScanningConfiguration.ScanOnPush, true);
    }
    const image = container(template, "api").Image;
    assert.match(JSON.stringify(image), /:3f9c2a1b"/);
  });
});

describe("least privilege", () => {
  const taskRole = (name: string) => {
    for (const [, task] of resources(template, "AWS::ECS::TaskDefinition")) {
      if ((task.Properties.ContainerDefinitions as Array<{ Name: string }>).some((c) => c.Name === name)) return refTo(task.Properties.TaskRoleArn)!;
    }
    throw new Error(name);
  };
  const resourceText = (s: { Resource: unknown }) => JSON.stringify(s.Resource);

  it("the API writes and removes only upload originals, and reads media", () => {
    const statements = statementsFor(template, taskRole("api"));
    for (const s of statements) {
      for (const a of actions(s)) assert.doesNotMatch(a, /\*/, `wildcard action ${a}`);
      assert.notEqual(s.Resource, "*");
    }
    const s3 = statements.filter((s) => actions(s).some((a) => a.startsWith("s3:")));
    const writes = s3.filter((s) => actions(s).some((a) => ["s3:PutObject", "s3:DeleteObject"].includes(a)));
    assert.equal(writes.length, 1);
    assert.match(resourceText(writes[0]!), /\/m\/\*\/original"/);
    const reads = s3.find((s) => actions(s).includes("s3:GetObject"))!;
    assert.match(resourceText(reads), /\/m\/\*"/);
    assert.ok(!s3.some((s) => actions(s).includes("s3:ListBucket")));
    const ses = statements.find((s) => actions(s).includes("ses:SendEmail"))!;
    assert.deepEqual(actions(ses), ["ses:SendEmail"]);
    assert.match(resourceText(ses), /identity\/katkee\.example/);
  });

  it("only the worker deletes processed media; the migration task has no AWS permissions", () => {
    const worker = statementsFor(template, taskRole("worker"));
    const media = worker.find((s) => actions(s).includes("s3:DeleteObject"))!;
    assert.match(resourceText(media), /\/m\/\*"/);
    assert.deepEqual(statementsFor(template, taskRole("migrate")), []);
  });

  it("tasks receive only the secrets they use", () => {
    const db = ["PGPASSWORD", "PGUSER"];
    assert.deepEqual(secretNames(container(template, "migrate")), ["DB_RUNTIME_PASSWORD", "DB_RUNTIME_USER", ...db].sort(), "migrations: database only");
    const worker = secretNames(container(template, "worker"));
    assert.ok(!worker.includes("ADMIN_MFA_ENCRYPTION_KEY"));
    assert.ok(secretNames(container(template, "api")).includes("ADMIN_MFA_ENCRYPTION_KEY"));
    const plain = synth(settings());
    const providerNames: string[] = Object.values(PROVIDER_CREDENTIALS).flat();
    assert.deepEqual(secretNames(container(plain.template, "api")).filter((n) => providerNames.includes(n)), ["CLOUDFRONT_PRIVATE_KEY"], "providers that are off get no credentials");
    assert.ok(!secretNames(container(plain.template, "api")).includes("PHONE_IDENTITY_SECRET"));
  });

  it("the services connect as the runtime role; only migrations use the owner", () => {
    const valueFrom = (name: string, key: string) => JSON.stringify(container(template, name).Secrets!.find((s) => s.Name === key)!.ValueFrom);
    for (const name of ["api", "worker"]) assert.match(valueFrom(name, "PGPASSWORD"), /DatabaseRuntimeSecret/);
    assert.match(valueFrom("migrate", "PGPASSWORD"), /DatabaseSecretAttachment/);
    assert.match(valueFrom("migrate", "DB_RUNTIME_PASSWORD"), /DatabaseRuntimeSecret/);
    const [, runtime] = only(template, "AWS::SecretsManager::Secret", (_id, r) => r.Properties.Name === `${SECRET_PREFIX}db-runtime`);
    assert.equal(JSON.parse(runtime.Properties.GenerateSecretString.SecretStringTemplate).username, "katkee_app");
  });
});

describe("configuration the API reads", () => {
  it("trusts forwarded client addresses only from the load balancer's subnets", () => {
    const env = envOf(container(template, "api"));
    const publicCidrs = resources(template, "AWS::EC2::Subnet").filter(([id]) => id.startsWith("VpcpublicSubnet")).map(([, s]) => s.Properties.CidrBlock).sort();
    assert.deepEqual(String(env.TRUSTED_PROXY_IPS).split(",").sort(), publicCidrs);
    assert.deepEqual(publicCidrs, ["10.40.0.0/24", "10.40.1.0/24"]);
  });

  it("sets production media, queue, email and analytics settings", () => {
    const env = envOf(container(template, "api"));
    assert.equal(env.MEDIA_STORE, "s3");
    assert.equal(env.MEDIA_QUEUE, "sqs");
    assert.equal(env.EMAIL_PROVIDER, "ses");
    assert.equal(env.ANALYTICS_TIME_ZONE, "Asia/Kolkata");
    assert.equal(env.ADMIN_ORIGIN, "https://api.katkee.example");
    assert.equal(env.ADMIN_CONSOLE_ENABLED, "true");
    assert.equal(envOf(container(template, "worker")).ADMIN_CONSOLE_ENABLED, "false");
    assert.equal(env.ADMIN_STATIC_ROOT, undefined, "the image's built console (dist/admin)");
    assert.equal(env.ADS_ENABLED, "false");
    assert.equal(env.MEDIA_WORKER_IN_PROCESS, undefined);
  });

  it("turns providers on with their settings, and off without them", () => {
    const on = envOf(container(template, "api"));
    assert.equal(on.APNS_BUNDLE_ID, "app.katkee");
    assert.deepEqual([on.PHONE_AUTH_ENABLED, on.PHONE_AUTH_COUNTRIES, on.TWILIO_VERIFY_SERVICE_SID], ["true", "IN", "VA0123456789abcdef0123456789abcdef"]);
    assert.deepEqual([on.GOOGLE_AUTH_ENABLED, on.GOOGLE_CLIENT_IDS], ["true", "1234-abc.apps.googleusercontent.com"]);
    const off = envOf(container(synth(settings()).template, "api"));
    for (const key of ["APNS_BUNDLE_ID", "PHONE_AUTH_ENABLED", "GOOGLE_AUTH_ENABLED", "TWILIO_VERIFY_SERVICE_SID"]) assert.equal(off[key], undefined, key);
  });
});

describe("edge protection, monitoring and backups", () => {
  it("puts a WAF in front of the API that never blocks what people write", () => {
    const [, acl] = only(template, "AWS::WAFv2::WebACL");
    const rules = acl.Properties.Rules as any[];
    const managed = rules.filter((r) => r.Statement.ManagedRuleGroupStatement).map((r) => r.Statement.ManagedRuleGroupStatement.Name);
    assert.deepEqual(managed, ["AWSManagedRulesCommonRuleSet", "AWSManagedRulesKnownBadInputsRuleSet", "AWSManagedRulesAmazonIpReputationList"]);
    const common = rules.find((r) => r.Name === "AWSManagedRulesCommonRuleSet");
    const counted = common.Statement.ManagedRuleGroupStatement.RuleActionOverrides.map((o: any) => o.Name);
    for (const rule of ["SizeRestrictions_BODY", "CrossSiteScripting_BODY", "GenericRFI_BODY", "EC2MetaDataSSRF_BODY"]) assert.ok(counted.includes(rule), rule);
    assert.ok(rules.some((r) => r.Statement.RateBasedStatement?.AggregateKeyType === "IP"));
    const admin = rules.find((r) => r.Name === "AdminOnlyFromAllowedIps");
    assert.equal(admin.Priority, 0);
    assert.match(JSON.stringify(admin.Statement), /"\/api\/v1\/admin"/);
    template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
    const [, logging] = only(template, "AWS::WAFv2::LoggingConfiguration");
    assert.deepEqual(logging.Properties.RedactedFields.map((f: any) => f.SingleHeader.Name), ["authorization", "cookie"]);
    // Without an allowlist the console is not IP-restricted (it still needs an Admin with MFA).
    const open = only(synth(settings()).template, "AWS::WAFv2::WebACL")[1].Properties.Rules as any[];
    assert.ok(!open.some((r) => r.Name === "AdminOnlyFromAllowedIps"));
  });

  it("alerts on errors, latency, failing tasks, database pressure and stuck media jobs", () => {
    // (The worker's queue-depth scaling adds its own two alarms, which drive scaling, not alerts.)
    const alarms = resources(template, "AWS::CloudWatch::Alarm").map(([id, a]) => [id, a.Properties] as const).filter(([id]) => !id.startsWith("WorkerServiceTaskCountTarget"));
    const names = alarms.map(([id]) => id.replace(/[A-F0-9]{8}$/, "")).sort();
    assert.deepEqual(names, ["Api5xx", "ApiCpu", "ApiLatencyP99", "ApiUnhealthyTasks", "DatabaseConnections", "DatabaseCpu", "DatabaseStorageLow", "LoadBalancer5xx", "MediaJobsBacklogAge", "MediaJobsDeadLetters", "WorkerMemory"]);
    const [topicId] = only(template, "AWS::SNS::Topic");
    for (const [id, a] of alarms) assert.deepEqual(a.AlarmActions.map(refTo), [topicId], id);
    const dlq = alarms.find(([id]) => id.startsWith("MediaJobsDeadLetters"))![1];
    assert.equal(dlq.Threshold, 1);
    template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: "ops@katkee.example" });
    template.hasResourceProperties("AWS::Budgets::Budget", { Budget: Match.objectLike({ BudgetLimit: { Amount: 500, Unit: "USD" } }) });
  });

  it("backs up the database and media daily (35 days) and monthly (a year)", () => {
    const [, plan] = only(template, "AWS::Backup::BackupPlan");
    const rules = plan.Properties.BackupPlan.BackupPlanRule.map((r: any) => [r.RuleName, r.Lifecycle.DeleteAfterDays]);
    assert.deepEqual(rules, [["Daily", 35], ["Monthly", 365]]);
    const [, selection] = only(template, "AWS::Backup::BackupSelection");
    const selected = JSON.stringify(selection.Properties.BackupSelection.Resources);
    assert.match(selected, /:rds:/);
    assert.match(selected, /MediaBucket/);
    const [, vault] = only(template, "AWS::Backup::BackupVault");
    assert.ok(refTo(vault.Properties.EncryptionKeyArn)?.startsWith("DataKey"));
  });
});

describe("modes and settings", () => {
  it("a release can migrate with the new image while the services still run the current one", () => {
    const release = synth(settings({ imageTag: "current1", migrationImageTag: "next2" })).template;
    assert.match(JSON.stringify(container(release, "migrate").Image), /:next2"/);
    assert.match(JSON.stringify(container(release, "api").Image), /:current1"/);
    assert.match(JSON.stringify(container(release, "worker").Image), /:current1"/);
    assert.match(JSON.stringify(container(template, "migrate").Image), /:3f9c2a1b"/, "defaults to imageTag");
  });

  it("bootstrap mode creates everything but runs no tasks", () => {
    const boot = synth(settings({ bootstrap: true })).template;
    for (const [, service] of resources(boot, "AWS::ECS::Service")) assert.equal(service.Properties.DesiredCount, 0);
    for (const [, target] of resources(boot, "AWS::ApplicationAutoScaling::ScalableTarget")) assert.equal(target.Properties.MinCapacity, 0);
  });

  it("refuses settings that would only fail after deploying", () => {
    const refusals: Array<[Parameters<typeof settings>[0], RegExp]> = [
      [{ apiCertificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/0f0e0d0c-1111" }, /ACM certificate in ap-south-1/],
      [{ cloudFrontPublicKeyPem: "-----BEGIN PUBLIC KEY-----" }, /cloudFrontPublicKeyPem must be a PEM public key/],
      [{ adminOrigin: "http://admin.katkee.example" }, /adminOrigin must be an exact https:\/\/ origin/],
      [{ adminOrigin: "https://admin.katkee.example/console" }, /adminOrigin must be an exact https:\/\/ origin/],
      [{ adminAllowedCidrs: ["admin-office"] }, /is not an IPv4 range/],
      [{ imageTag: "latest tag" }, /latest tag is not a Docker image tag/],
      [{ migrationImageTag: "v2;rm" }, /v2;rm is not a Docker image tag/],
      [{ providers: { fcm: false, safeBrowsing: false, googleClientIds: [], phone: { verifyServiceSid: "service", countries: ["IN"] } } }, /Twilio Verify service SID/],
      [{ providers: { fcm: false, safeBrowsing: false, googleClientIds: [], phone: { verifyServiceSid: "VA0123456789abcdef0123456789abcdef", countries: ["India"] } } }, /ISO country codes/],
      [{ monthlyBudgetUsd: Number.NaN }, /monthlyBudgetUsd/],
    ];
    for (const [overrides, error] of refusals) assert.throws(() => synth(settings(overrides)), error, JSON.stringify(overrides));
  });
});
