import { createPublicKey } from "node:crypto";
import {
  ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps,
  aws_applicationautoscaling as appscaling,
  aws_backup as backup,
  aws_budgets as budgets,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cwActions,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_events as events,
  aws_iam as iam,
  aws_kms as kms,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_sqs as sqs,
  aws_wafv2 as wafv2,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface KatkeeSettings {
  /** Image tag (e.g. the git commit) already pushed to both ECR repositories. */
  imageTag: string;
  /**
   * The image the migration task runs; defaults to imageTag. A release migrates first: deploy
   * with the new tag here and the current one in imageTag, run the task, then deploy the new
   * imageTag (infra/README.md). Migrations are additive, so the running version keeps working.
   */
  migrationImageTag?: string | undefined;
  /** Public API host name, e.g. api.katkee.app, and its ACM certificate in ap-south-1. */
  apiDomainName: string;
  apiCertificateArn: string;
  /** Exact HTTPS origin the Admin console is opened from; defaults to https://<apiDomainName>. */
  adminOrigin?: string | undefined;
  adminConsoleEnabled: boolean;
  /** When set, /admin and /api/v1/admin answer only these IPv4 ranges (WAF). */
  adminAllowedCidrs?: string[] | undefined;
  /** Verified SES sender ("Katkee <no-reply@katkee.app>") and its SES identity (domain or address). */
  emailFrom: string;
  sesIdentity: string;
  /** PEM public key of the CloudFront signing key pair; the private key goes in its secret. */
  cloudFrontPublicKeyPem: string;
  alarmEmail: string;
  monthlyBudgetUsd: number;
  /** RDS instance type without the "db." prefix, e.g. t4g.medium or m7g.large. */
  databaseInstanceType: string;
  /**
   * Recovery only: the endpoint of a restored instance (docs/BACKUP_AND_RESTORE.md) for the
   * services and migrations to use instead of the stack's own database.
   */
  databaseHost?: string | undefined;
  /** Where an analytics day starts (an IANA zone). Choose before launch: see docs/ANALYTICS.md. */
  analyticsTimeZone: string;
  /** Providers turn on only after their credentials are in Secrets Manager (infra/README.md). */
  providers: {
    fcm: boolean;
    apns?: { bundleId: string } | undefined;
    phone?: { verifyServiceSid: string; countries: string[] } | undefined;
    safeBrowsing: boolean;
    /** Google sign-in: the OAuth client IDs whose tokens the API accepts. Empty turns it off. */
    googleClientIds: string[];
  };
  features: { ads: boolean; sponsoredStories: boolean; adReporting: boolean };
  /** First deploy only: create everything but run no tasks until secrets and images are in place. */
  bootstrap: boolean;
}

export interface KatkeeStackProps extends StackProps {
  settings: KatkeeSettings;
}

export const SECRET_PREFIX = "katkee/production/";

/**
 * Provider credentials, one secret each. The stack creates them with a random placeholder;
 * operators replace it with the real value (infra/README.md). The CloudFront key is always
 * needed (the API refuses to start with a placeholder); the others are given to the tasks only
 * when their provider is turned on.
 */
export const PROVIDER_CREDENTIALS = {
  cloudFront: ["CLOUDFRONT_PRIVATE_KEY"],
  fcm: ["FCM_SERVICE_ACCOUNT_JSON"],
  apns: ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY"],
  phone: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  safeBrowsing: ["SAFE_BROWSING_API_KEY"],
} as const;

const API_PORT = 4000;
/** The CA bundle the image carries for verified TLS to RDS (backend/Dockerfile, backend/certs). */
export const RDS_CA_BUNDLE = "/app/certs/rds-ap-south-1-bundle.pem";

/** Refuses settings that would only fail after deploying. */
export function validateSettings(s: KatkeeSettings): void {
  const problems: string[] = [];
  for (const tag of [s.imageTag, s.migrationImageTag ?? s.imageTag]) if (!/^[A-Za-z0-9._-]{1,128}$/.test(tag)) problems.push(`${tag} is not a Docker image tag`);
  if (!/^arn:aws:acm:ap-south-1:\d{12}:certificate\/[0-9a-f-]+$/.test(s.apiCertificateArn)) problems.push("apiCertificateArn must be an ACM certificate in ap-south-1");
  const adminOrigin = s.adminOrigin ?? `https://${s.apiDomainName}`;
  try {
    if (new URL(adminOrigin).origin !== adminOrigin || !adminOrigin.startsWith("https://")) problems.push("adminOrigin must be an exact https:// origin");
  } catch {
    problems.push("adminOrigin must be an exact https:// origin");
  }
  try {
    if (createPublicKey(s.cloudFrontPublicKeyPem).asymmetricKeyType !== "rsa") problems.push("cloudFrontPublicKeyPem must be an RSA public key");
  } catch {
    problems.push("cloudFrontPublicKeyPem must be a PEM public key");
  }
  for (const cidr of s.adminAllowedCidrs ?? []) if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr)) problems.push(`adminAllowedCidrs: ${cidr} is not an IPv4 range`);
  if (!/^[a-z0-9]+\.[a-z0-9]+$/.test(s.databaseInstanceType)) problems.push("databaseInstanceType must look like t4g.medium");
  if (s.databaseHost !== undefined && !/^[a-z0-9-]+\.[a-z0-9]+\.ap-south-1\.rds\.amazonaws\.com$/.test(s.databaseHost)) problems.push("databaseHost must be an RDS endpoint in ap-south-1");
  if (s.providers.apns && !/^[A-Za-z0-9.-]+$/.test(s.providers.apns.bundleId)) problems.push("apnsBundleId must be the iOS bundle ID");
  if (s.providers.phone) {
    if (!/^VA[0-9a-f]{32}$/i.test(s.providers.phone.verifyServiceSid)) problems.push("twilioVerifyServiceSid must be a Twilio Verify service SID (VA...)");
    if (!s.providers.phone.countries.length || s.providers.phone.countries.some((c) => !/^[A-Z]{2}$/.test(c))) problems.push("phoneAuthCountries must be ISO country codes such as IN");
  }
  if (!Number.isFinite(s.monthlyBudgetUsd) || s.monthlyBudgetUsd <= 0) problems.push("monthlyBudgetUsd must be a positive number");
  if (problems.length) throw new Error(`Katkee settings: ${problems.join("; ")}.`);
}

/**
 * Katkee production in ap-south-1 (Mumbai):
 * - VPC over two availability zones. Load balancer in public subnets, tasks in private subnets,
 *   the database in isolated subnets. NAT gateways for outbound calls (FCM, APNs, Twilio).
 * - API and media worker on ECS Fargate from ECR images; a one-off migration task.
 * - PostgreSQL 16 on RDS: Multi-AZ, encrypted, TLS only, point-in-time recovery, AWS Backup.
 *   Migrations run as the schema owner; the API and worker connect as a runtime role that can
 *   only read and write rows (backend/scripts/runtime-role.ts).
 * - Media in a private S3 bucket, delivered only through CloudFront signed URLs (OAC); jobs on
 *   SQS with a dead-letter queue.
 * - WAF, alarms to email, and a monthly budget.
 */
export class KatkeeStack extends Stack {
  constructor(scope: Construct, id: string, props: KatkeeStackProps) {
    super(scope, id, props);
    const s = props.settings;
    validateSettings(s);
    const adminOrigin = s.adminOrigin ?? `https://${s.apiDomainName}`;
    Tags.of(this).add("app", "katkee");
    Tags.of(this).add("environment", "production");

    // ---------------------------------------------------------------- network
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/16"),
      maxAzs: 2,
      natGateways: 2, // one per zone: losing a zone doesn't cut the other zone's outbound calls
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    // Media traffic between tasks and S3 stays inside AWS (and off the NAT bill).
    vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });

    const albSg = new ec2.SecurityGroup(this, "LoadBalancerSg", { vpc, description: "Public HTTPS", allowAllOutbound: false });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP, redirected to HTTPS");
    const apiSg = new ec2.SecurityGroup(this, "ApiSg", { vpc, description: "API tasks: only the load balancer reaches them" });
    apiSg.addIngressRule(albSg, ec2.Port.tcp(API_PORT), "From the load balancer");
    albSg.addEgressRule(apiSg, ec2.Port.tcp(API_PORT), "To API tasks");
    const workerSg = new ec2.SecurityGroup(this, "WorkerSg", { vpc, description: "Media worker and migrations: no inbound traffic" });
    const dbSg = new ec2.SecurityGroup(this, "DatabaseSg", { vpc, description: "PostgreSQL: API, worker and migrations only", allowAllOutbound: false });
    dbSg.addIngressRule(apiSg, ec2.Port.tcp(5432), "API");
    dbSg.addIngressRule(workerSg, ec2.Port.tcp(5432), "Worker and migrations");

    // ---------------------------------------------------------------- keys and secrets
    const dataKey = new kms.Key(this, "DataKey", {
      alias: "alias/katkee-data",
      description: "Katkee data at rest: database, backups, secrets",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const secret = (id: string, name: string, description: string, generate?: secretsmanager.SecretStringGenerator) =>
      new secretsmanager.Secret(this, id, {
        secretName: `${SECRET_PREFIX}${name}`,
        description,
        encryptionKey: dataKey,
        // Without a generator the secret starts as a random placeholder, never a usable value.
        ...(generate ? { generateSecretString: generate } : {}),
        removalPolicy: RemovalPolicy.RETAIN,
      });
    const jwtAccess = secret("JwtAccessSecret", "JWT_ACCESS_SECRET", "Signs access tokens", { passwordLength: 64, excludePunctuation: true });
    const jwtRefresh = secret("JwtRefreshSecret", "JWT_REFRESH_SECRET", "Signs refresh tokens", { passwordLength: 64, excludePunctuation: true });
    // 64 hexadecimal characters (32 bytes), the format ADMIN_MFA_ENCRYPTION_KEY requires.
    const adminMfaKey = secret("AdminMfaKey", "ADMIN_MFA_ENCRYPTION_KEY", "Encrypts Admin TOTP secrets at rest", {
      passwordLength: 64, excludePunctuation: true, excludeUppercase: true, excludeCharacters: "ghijklmnopqrstuvwxyz",
    });
    // Keys phone numbers in the database; changing it orphans existing phone sign-ins.
    const phoneIdentity = secret("PhoneIdentitySecret", "PHONE_IDENTITY_SECRET", "Keys phone identities", { passwordLength: 64, excludePunctuation: true });
    const providerSecrets = new Map<string, secretsmanager.Secret>();
    for (const names of Object.values(PROVIDER_CREDENTIALS)) {
      for (const name of names) {
        const id = name.toLowerCase().replace(/(^|_)([a-z])/g, (_m, _s, c: string) => c.toUpperCase());
        providerSecrets.set(name, secret(id, name, `${name}: replace the placeholder with the provider's value (infra/README.md)`));
      }
    }
    // The role the API and worker connect as; the migration task creates it and keeps its password in sync.
    const runtimeDbSecret = secret("DatabaseRuntimeSecret", "db-runtime", "PostgreSQL runtime role (rows only)", {
      secretStringTemplate: JSON.stringify({ username: "katkee_app" }), generateStringKey: "password", passwordLength: 40, excludePunctuation: true,
    });

    // ---------------------------------------------------------------- database
    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 });
    let dbParameters: rds.ParameterGroup;
    const db = new rds.DatabaseInstance(this, "Database", {
      engine,
      instanceType: new ec2.InstanceType(s.databaseInstanceType),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      publiclyAccessible: false,
      multiAz: true,
      databaseName: "katkee",
      // The schema owner: migrations and break-glass access only.
      credentials: rds.Credentials.fromGeneratedSecret("katkee_owner", { encryptionKey: dataKey, secretName: `${SECRET_PREFIX}db-owner` }),
      allocatedStorage: 50,
      maxAllocatedStorage: 500,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: dataKey,
      // The API verifies this CA (backend/certs/rds-ap-south-1-bundle.pem, PGSSLMODE=verify-full).
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      parameterGroup: (dbParameters = new rds.ParameterGroup(this, "DatabaseParameters", {
        engine,
        parameters: {
          "rds.force_ssl": "1",
          // Statements carry user text (messages, captions) as literals: logs never include them.
          log_min_error_statement: "panic",
          idle_in_transaction_session_timeout: "60000",
        },
      })),
      backupRetention: Duration.days(14), // point-in-time recovery to any second in the last 14 days
      preferredBackupWindow: "19:30-20:30", // 01:00–02:00 IST
      preferredMaintenanceWindow: "sun:21:00-sun:22:00", // Monday 02:30–03:30 IST
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: dataKey,
      monitoringInterval: Duration.seconds(60),
      cloudwatchLogsExports: ["postgresql", "upgrade"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    });
    // Like the final snapshot, the owner's credentials outlive the stack.
    (db.node.findChild("Secret") as secretsmanager.Secret).applyRemovalPolicy(RemovalPolicy.RETAIN);

    // ---------------------------------------------------------------- media
    const logsBucket = new s3.Bucket(this, "LogsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, // what load balancer log delivery supports
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true, // recovery from accidental deletes and overwrites; AWS Backup needs it
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: "s3-media/",
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(2) }, // abandoned resumable uploads
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const signingKey = new cloudfront.PublicKey(this, "MediaSigningKey", {
      encodedKey: s.cloudFrontPublicKeyPem,
      comment: "Verifies Katkee's signed media URLs",
    });
    const media = new cloudfront.Distribution(this, "MediaCdn", {
      comment: "Katkee media: signed URLs only",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        trustedKeyGroups: [new cloudfront.KeyGroup(this, "MediaKeyGroup", { items: [signingKey] })],
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: false, // images and video are already compressed
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes edge locations in India
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    const jobsDlq = new sqs.Queue(this, "MediaJobsDlq", {
      encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true, retentionPeriod: Duration.days(14),
    });
    // A wake-up signal: jobs, leases and retries live in PostgreSQL. Undeliverable messages land here.
    const jobs = new sqs.Queue(this, "MediaJobs", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.minutes(15), // the worker's job lease
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: jobsDlq, maxReceiveCount: 5 },
    });

    // ---------------------------------------------------------------- containers
    const repository = (id: string, name: string) => new ecr.Repository(this, id, {
      repositoryName: name,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ maxImageCount: 50 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const apiRepo = repository("ApiRepository", "katkee-api");
    const workerRepo = repository("WorkerRepository", "katkee-worker");

    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    const sesIdentityArn = this.formatArn({ service: "ses", resource: "identity", resourceName: s.sesIdentity });

    // What every process needs to reach the database: verified TLS against the RDS CA.
    const databaseEnvironment: Record<string, string> = {
      NODE_ENV: "production",
      AWS_REGION: this.region,
      PGHOST: s.databaseHost ?? db.dbInstanceEndpointAddress,
      PGPORT: db.dbInstanceEndpointPort,
      PGDATABASE: "katkee",
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: RDS_CA_BUNDLE,
    };
    // The app's settings (backend/src/config/env.ts). Credentials come from Secrets Manager
    // below, never as plain values in the template.
    const { apns, phone } = s.providers;
    const appEnvironment: Record<string, string> = {
      ...databaseEnvironment,
      EMAIL_PROVIDER: "ses",
      EMAIL_FROM: s.emailFrom,
      MEDIA_STORE: "s3",
      MEDIA_S3_BUCKET: mediaBucket.bucketName,
      MEDIA_QUEUE: "sqs",
      MEDIA_SQS_QUEUE_URL: jobs.queueUrl,
      MEDIA_CDN_DOMAIN: media.distributionDomainName,
      CLOUDFRONT_KEY_PAIR_ID: signingKey.publicKeyId,
      ADMIN_ORIGIN: adminOrigin,
      ANALYTICS_TIME_ZONE: s.analyticsTimeZone,
      ADS_ENABLED: String(s.features.ads),
      SPONSORED_STORIES_ENABLED: String(s.features.sponsoredStories),
      AD_REPORTING_ENABLED: String(s.features.adReporting),
      // Client addresses for rate limits: only the load balancer's subnets may forward them.
      TRUSTED_PROXY_IPS: vpc.publicSubnets.map((subnet) => subnet.ipv4CidrBlock).join(","),
      ...(apns ? { APNS_BUNDLE_ID: apns.bundleId } : {}),
      ...(phone ? { PHONE_AUTH_ENABLED: "true", PHONE_AUTH_COUNTRIES: phone.countries.join(","), TWILIO_VERIFY_SERVICE_SID: phone.verifyServiceSid } : {}),
      ...(s.providers.googleClientIds.length ? { GOOGLE_AUTH_ENABLED: "true", GOOGLE_CLIENT_IDS: s.providers.googleClientIds.join(",") } : {}),
    };
    const fromSecret = (name: string) => ecs.Secret.fromSecretsManager(providerSecrets.get(name)!);
    const enabledCredentials = [
      ...PROVIDER_CREDENTIALS.cloudFront,
      ...(s.providers.fcm ? PROVIDER_CREDENTIALS.fcm : []),
      ...(apns ? PROVIDER_CREDENTIALS.apns : []),
      ...(phone ? PROVIDER_CREDENTIALS.phone : []),
      ...(s.providers.safeBrowsing ? PROVIDER_CREDENTIALS.safeBrowsing : []),
    ];
    const appSecrets: Record<string, ecs.Secret> = {
      PGUSER: ecs.Secret.fromSecretsManager(runtimeDbSecret, "username"),
      PGPASSWORD: ecs.Secret.fromSecretsManager(runtimeDbSecret, "password"),
      JWT_ACCESS_SECRET: ecs.Secret.fromSecretsManager(jwtAccess),
      JWT_REFRESH_SECRET: ecs.Secret.fromSecretsManager(jwtRefresh),
      ...(phone ? { PHONE_IDENTITY_SECRET: ecs.Secret.fromSecretsManager(phoneIdentity) } : {}),
      ...Object.fromEntries(enabledCredentials.map((name) => [name, fromSecret(name)])),
    };
    const logGroup = (id: string) => new logs.LogGroup(this, id, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const runtimePlatform = { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX };
    /**
     * A writable /tmp on an otherwise read-only root file system. The image declares /tmp as a
     * volume so this one starts with its permissions (backend/Dockerfile); the app refuses to
     * start in production when it cannot write there.
     */
    const withScratch = (task: ecs.FargateTaskDefinition, container: ecs.ContainerDefinition) => {
      task.addVolume({ name: "tmp" });
      container.addMountPoints({ containerPath: "/tmp", sourceVolume: "tmp", readOnly: false });
    };

    // API
    const apiTask = new ecs.FargateTaskDefinition(this, "ApiTask", { cpu: 512, memoryLimitMiB: 1024, runtimePlatform });
    const apiContainer = apiTask.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, s.imageTag),
      environment: { ...appEnvironment, PORT: String(API_PORT), ADMIN_CONSOLE_ENABLED: String(s.adminConsoleEnabled) },
      secrets: { ...appSecrets, ...(s.adminConsoleEnabled ? { ADMIN_MFA_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(adminMfaKey) } : {}) },
      portMappings: [{ containerPort: API_PORT }],
      readonlyRootFilesystem: true,
      // The API drains for 3 s and waits up to 20 s for in-flight requests (backend/src/http/lifecycle.ts).
      stopTimeout: Duration.seconds(30),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logGroup: logGroup("ApiLogs") }),
    });
    withScratch(apiTask, apiContainer);
    // Uploads write only originals (m/<id>/original, also through the part URLs the API signs),
    // and the API removes an original that arrived damaged. Processed variants are the worker's.
    apiTask.addToTaskRolePolicy(new iam.PolicyStatement({
      sid: "UploadOriginals",
      actions: ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:DeleteObject"],
      resources: [mediaBucket.arnForObjects("m/*/original")],
    }));
    apiTask.addToTaskRolePolicy(new iam.PolicyStatement({ sid: "ReadMedia", actions: ["s3:GetObject"], resources: [mediaBucket.arnForObjects("m/*")] }));
    jobs.grantSendMessages(apiTask.taskRole);
    apiTask.addToTaskRolePolicy(new iam.PolicyStatement({ sid: "SendEmail", actions: ["ses:SendEmail"], resources: [sesIdentityArn] }));

    // Media worker (ffmpeg), push delivery and retention.
    const workerTask = new ecs.FargateTaskDefinition(this, "WorkerTask", { cpu: 1024, memoryLimitMiB: 2048, ephemeralStorageGiB: 50, runtimePlatform });
    const workerContainer = workerTask.addContainer("worker", {
      image: ecs.ContainerImage.fromEcrRepository(workerRepo, s.imageTag),
      environment: { ...appEnvironment, ADMIN_CONSOLE_ENABLED: "false", WORKER_HEARTBEAT_FILE: "/tmp/katkee-worker-heartbeat" },
      secrets: appSecrets,
      readonlyRootFilesystem: true,
      stopTimeout: Duration.seconds(120), // finish the job in hand; an interrupted one is retried after its lease
      healthCheck: {
        command: ["CMD", "node", "-e", "const s=require('fs').statSync(process.env.WORKER_HEARTBEAT_FILE);process.exit(Date.now()-s.mtimeMs<120000?0:1)"],
        interval: Duration.seconds(30), timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(60),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "worker", logGroup: logGroup("WorkerLogs") }),
    });
    withScratch(workerTask, workerContainer);
    workerTask.addToTaskRolePolicy(new iam.PolicyStatement({
      sid: "ProcessAndRetainMedia",
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      resources: [mediaBucket.arnForObjects("m/*")],
    }));
    jobs.grantConsumeMessages(workerTask.taskRole);
    workerTask.addToTaskRolePolicy(new iam.PolicyStatement({ sid: "SendEmail", actions: ["ses:SendEmail"], resources: [sesIdentityArn] }));

    // Migrations, once per release before the services update (infra/README.md). Database access
    // only: connects as the schema owner and keeps the runtime role and its grants current.
    const migrateTask = new ecs.FargateTaskDefinition(this, "MigrateTask", { cpu: 256, memoryLimitMiB: 512, runtimePlatform });
    const migrateContainer = migrateTask.addContainer("migrate", {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, s.migrationImageTag ?? s.imageTag),
      command: ["node", "dist/scripts/migrate.js"],
      environment: databaseEnvironment,
      secrets: {
        PGUSER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
        DB_RUNTIME_USER: ecs.Secret.fromSecretsManager(runtimeDbSecret, "username"),
        DB_RUNTIME_PASSWORD: ecs.Secret.fromSecretsManager(runtimeDbSecret, "password"),
      },
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migrate", logGroup: logGroup("MigrateLogs") }),
    });
    withScratch(migrateTask, migrateContainer);

    // ---------------------------------------------------------------- load balancer and services
    const alb = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSg,
      idleTimeout: Duration.seconds(120), // above the realtime socket's 30 s ping
      dropInvalidHeaderFields: true,
      deletionProtection: true,
    });
    alb.logAccessLogs(logsBucket, "alb");
    const apiTargets = new elbv2.ApplicationTargetGroup(this, "ApiTargets", {
      vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: Duration.seconds(20),
      healthCheck: {
        // 503 while draining or when the database is unreachable, so a deploy with a broken
        // database setting never goes live. Ten misses (2.5 minutes) before a task is replaced:
        // a Multi-AZ failover takes 1–2 minutes and shouldn't recycle every task.
        path: "/ready",
        healthyHttpCodes: "200",
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 10,
      },
    });
    alb.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [elbv2.ListenerCertificate.fromArn(s.apiCertificateArn)],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultTargetGroups: [apiTargets],
    });
    alb.addRedirect({ sourcePort: 80, sourceProtocol: elbv2.ApplicationProtocol.HTTP, targetPort: 443, targetProtocol: elbv2.ApplicationProtocol.HTTPS });

    // Autoscaling owns the running count: deploys leave it alone (no desiredCount) except in
    // bootstrap mode, which runs nothing until secrets and images exist.
    const api = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition: apiTask,
      ...(s.bootstrap ? { desiredCount: 0 } : {}),
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      assignPublicIp: false,
      healthCheckGracePeriod: Duration.seconds(60),
    });
    api.attachToApplicationTargetGroup(apiTargets);
    api.autoScaleTaskCount({ minCapacity: s.bootstrap ? 0 : 2, maxCapacity: 10 })
      .scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    const worker = new ecs.FargateService(this, "WorkerService", {
      cluster,
      taskDefinition: workerTask,
      ...(s.bootstrap ? { desiredCount: 0 } : {}),
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [workerSg],
      assignPublicIp: false,
    });
    worker.autoScaleTaskCount({ minCapacity: s.bootstrap ? 0 : 1, maxCapacity: 4 }).scaleOnMetric("QueueDepth", {
      metric: jobs.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      scalingSteps: [{ upper: 0, change: -1 }, { lower: 10, change: +1 }, { lower: 100, change: +2 }],
    });

    // ---------------------------------------------------------------- WAF
    const visibility = (name: string) => ({ cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true });
    const managed = (name: string, priority: number, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
      name, priority, overrideAction: { none: {} }, visibilityConfig: visibility(name),
      statement: { managedRuleGroupStatement: { vendorName: "AWS", name, ruleActionOverrides: countOnly.map((rule) => ({ name: rule, actionToUse: { count: {} } })) } },
    });
    const rules: wafv2.CfnWebACL.RuleProperty[] = [
      // Bodies are what people write (messages, captions, comments): body rules only count, so
      // nobody is blocked for typing a URL, an address or markup.
      managed("AWSManagedRulesCommonRuleSet", 10, ["SizeRestrictions_BODY", "CrossSiteScripting_BODY", "GenericLFI_BODY", "GenericRFI_BODY", "EC2MetaDataSSRF_BODY"]),
      managed("AWSManagedRulesKnownBadInputsRuleSet", 20),
      managed("AWSManagedRulesAmazonIpReputationList", 30),
      {
        // Generous per address: many people in India share one carrier address (CGNAT). The API has its own limits.
        name: "RateLimitPerIp", priority: 40, action: { block: {} }, visibilityConfig: visibility("RateLimitPerIp"),
        statement: { rateBasedStatement: { limit: 20000, aggregateKeyType: "IP" } },
      },
    ];
    if (s.adminAllowedCidrs?.length) {
      const adminIps = new wafv2.CfnIPSet(this, "AdminAllowedIps", { scope: "REGIONAL", ipAddressVersion: "IPV4", addresses: s.adminAllowedCidrs });
      const pathStarts = (prefix: string): wafv2.CfnWebACL.StatementProperty => ({
        byteMatchStatement: { fieldToMatch: { uriPath: {} }, positionalConstraint: "STARTS_WITH", searchString: prefix, textTransformations: [{ priority: 0, type: "NONE" }] },
      });
      rules.unshift({
        name: "AdminOnlyFromAllowedIps", priority: 0, action: { block: {} }, visibilityConfig: visibility("AdminOnlyFromAllowedIps"),
        statement: { andStatement: { statements: [
          { orStatement: { statements: [pathStarts("/admin"), pathStarts("/api/v1/admin")] } },
          { notStatement: { statement: { ipSetReferenceStatement: { arn: adminIps.attrArn } } } },
        ] } },
      });
    }
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "REGIONAL", defaultAction: { allow: {} }, visibilityConfig: visibility("KatkeeApi"), rules,
    });
    new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", { resourceArn: alb.loadBalancerArn, webAclArn: webAcl.attrArn });
    const wafLogs = new logs.LogGroup(this, "WafLogs", {
      logGroupName: "aws-waf-logs-katkee", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN,
    });
    new wafv2.CfnLoggingConfiguration(this, "WafLogging", {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [this.formatArn({ service: "logs", resource: "log-group", resourceName: wafLogs.logGroupName, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
      redactedFields: [{ singleHeader: { Name: "authorization" } }, { singleHeader: { Name: "cookie" } }],
    });

    // ---------------------------------------------------------------- alarms and budget
    const alerts = new sns.Topic(this, "Alerts", { displayName: "Katkee production alerts" });
    alerts.addSubscription(new subscriptions.EmailSubscription(s.alarmEmail));
    const alarm = (id: string, description: string, metric: cloudwatch.IMetric, threshold: number, evaluationPeriods = 3,
      comparisonOperator = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD) => {
      new cloudwatch.Alarm(this, id, {
        alarmDescription: description, metric, threshold, evaluationPeriods, comparisonOperator,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cwActions.SnsAction(alerts));
    };
    const fiveMinutes = { period: Duration.minutes(5) };
    alarm("Api5xx", "API answers with server errors", apiTargets.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { ...fiveMinutes, statistic: "Sum" }), 25, 2);
    alarm("LoadBalancer5xx", "The load balancer itself fails requests (no healthy task, timeouts)", alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { ...fiveMinutes, statistic: "Sum" }), 10, 2);
    alarm("ApiLatencyP99", "API p99 latency above 2 s", apiTargets.metrics.targetResponseTime({ ...fiveMinutes, statistic: "p99" }), 2, 3);
    alarm("ApiUnhealthyTasks", "API tasks failing /ready", apiTargets.metrics.unhealthyHostCount({ period: Duration.minutes(1), statistic: "Maximum" }), 1, 3);
    alarm("ApiCpu", "API CPU sustained high", api.metricCpuUtilization(fiveMinutes), 85, 3);
    alarm("WorkerMemory", "Media worker memory high (large video)", worker.metricMemoryUtilization(fiveMinutes), 90, 2);
    alarm("DatabaseCpu", "Database CPU sustained high", db.metricCPUUtilization(fiveMinutes), 80, 3);
    alarm("DatabaseStorageLow", "Database free storage below 10 GB", db.metricFreeStorageSpace(fiveMinutes), 10 * 1024 ** 3, 1, cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD);
    alarm("DatabaseConnections", "Database connections near the limit", db.metricDatabaseConnections(fiveMinutes), 300, 2);
    alarm("MediaJobsDeadLetters", "Media job messages could not be delivered", jobsDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Maximum" }), 1, 1);
    alarm("MediaJobsBacklogAge", "Media jobs waiting over 15 minutes", jobs.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5), statistic: "Maximum" }), 900, 2);

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: { budgetName: "katkee-monthly", budgetType: "COST", timeUnit: "MONTHLY", budgetLimit: { amount: s.monthlyBudgetUsd, unit: "USD" } },
      notificationsWithSubscribers: [
        { notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80, thresholdType: "PERCENTAGE" }, subscribers: [{ subscriptionType: "EMAIL", address: s.alarmEmail }] },
        { notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" }, subscribers: [{ subscriptionType: "EMAIL", address: s.alarmEmail }] },
      ],
    });

    // ---------------------------------------------------------------- backups
    const vault = new backup.BackupVault(this, "BackupVault", { encryptionKey: dataKey, removalPolicy: RemovalPolicy.RETAIN });
    const plan = new backup.BackupPlan(this, "BackupPlan", { backupVault: vault });
    plan.addRule(new backup.BackupPlanRule({
      ruleName: "Daily", scheduleExpression: events.Schedule.cron({ hour: "20", minute: "30" }), deleteAfter: Duration.days(35),
    }));
    plan.addRule(new backup.BackupPlanRule({
      ruleName: "Monthly", scheduleExpression: events.Schedule.cron({ day: "1", hour: "21", minute: "0" }), deleteAfter: Duration.days(365),
    }));
    const backupRole = new iam.Role(this, "BackupRole", {
      assumedBy: new iam.ServicePrincipal("backup.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBackupServiceRolePolicyForBackup"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBackupServiceRolePolicyForRestores"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSBackupServiceRolePolicyForS3Backup"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSBackupServiceRolePolicyForS3Restore"),
      ],
    });
    plan.addSelection("Data", {
      role: backupRole,
      resources: [backup.BackupResource.fromRdsDatabaseInstance(db), backup.BackupResource.fromArn(mediaBucket.bucketArn)],
    });

    // ---------------------------------------------------------------- outputs
    const output = (id: string, value: string, description: string) => new CfnOutput(this, id, { value, description });
    output("ApiUrl", `https://${s.apiDomainName}`, "Point this name (DNS) at LoadBalancerDns");
    output("LoadBalancerDns", alb.loadBalancerDnsName, "CNAME/alias target for the API name");
    output("MediaCdnDomain", media.distributionDomainName, "MEDIA_CDN_DOMAIN");
    output("ApiRepositoryUri", apiRepo.repositoryUri, "Push the API image here");
    output("WorkerRepositoryUri", workerRepo.repositoryUri, "Push the worker image here");
    output("ClusterName", cluster.clusterName, "For one-off tasks (migrations, first Super Admin)");
    output("ApiServiceName", api.serviceName, "aws ecs describe-services / update-service");
    output("WorkerServiceName", worker.serviceName, "aws ecs describe-services / update-service");
    output("ApiTaskDefinition", apiTask.taskDefinitionArn, "For the first Super Admin (infra/README.md)");
    output("MigrateTaskDefinition", migrateTask.taskDefinitionArn, "aws ecs run-task (infra/README.md)");
    output("TaskSubnets", vpc.privateSubnets.map((subnet) => subnet.subnetId).join(","), "Subnets for one-off tasks");
    output("MigrateSecurityGroup", workerSg.securityGroupId, "Security group for the migration task");
    output("ApiSecurityGroup", apiSg.securityGroupId, "Security group for one-off API tasks");
    output("DatabaseEndpoint", db.dbInstanceEndpointAddress, "PostgreSQL (TLS only, private)");
    // For restores (docs/BACKUP_AND_RESTORE.md): a restored instance gets the same network, settings and CA.
    output("DatabaseInstanceId", db.instanceIdentifier, "aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier");
    output("DatabaseSubnetGroup", (db.node.findChild("SubnetGroup") as rds.SubnetGroup).subnetGroupName, "--db-subnet-group-name for a restore");
    output("DatabaseSecurityGroup", dbSg.securityGroupId, "--vpc-security-group-ids for a restore");
    output("DatabaseParameterGroup", dbParameters!.bindToInstance({}).parameterGroupName, "--db-parameter-group-name for a restore");
    output("MediaBucketName", mediaBucket.bucketName, "Media objects (versioned)");
    output("BackupVaultName", vault.backupVaultName, "AWS Backup recovery points");
  }
}
