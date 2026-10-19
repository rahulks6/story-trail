#!/usr/bin/env node
/**
 * Releases a server version whose images (katkee-api:<tag>, katkee-worker:<tag>) are already in
 * ECR, in the only safe order:
 *   1. point the migration task at the new image (services keep running the current one);
 *   2. run the migrations and require exit code 0;
 *   3. move the API and worker to the new image;
 *   4. run the live checks.
 * Skipping step 2 serves new code against an old schema ("column does not exist"), which is
 * what broke Stories on 19 October 2026. The API's /ready also refuses until the migrations
 * have run, so ECS rolls a version back rather than serving it.
 *
 *   node scripts/release-server.cjs r8
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const tag = process.argv[2];
if (!tag || !/^[A-Za-z0-9._-]{1,128}$/.test(tag)) {
  console.error("Usage: node scripts/release-server.cjs <image tag>");
  process.exit(1);
}
const root = path.join(__dirname, "..");
const infra = path.join(root, "infra");
const contextFile = path.join(infra, "cdk.context.json");
const region = "ap-south-1";
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
const aws = (...args) => run("aws", ["--region", region, ...args]);
const output = (key) => aws("cloudformation", "describe-stacks", "--stack-name", "KatkeeProduction", "--query", `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, "--output", "text");
const writeContext = (change) => {
  const ctx = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  change(ctx);
  fs.writeFileSync(contextFile, JSON.stringify(ctx, null, 2) + "\n");
};
const deploy = (label) => {
  console.log(`\n== ${label}`);
  execFileSync("npx", ["cdk", "deploy", "--require-approval", "never"], { cwd: infra, stdio: "inherit" });
};

for (const repo of ["katkee-api", "katkee-worker"]) {
  aws("ecr", "describe-images", "--repository-name", repo, "--image-ids", `imageTag=${tag}`, "--query", "imageDetails[0].imageTags");
}

writeContext((ctx) => { ctx.migrationImageTag = tag; });
deploy(`1. migration task -> ${tag}`);

console.log("\n== 2. migrations");
const cluster = output("ClusterName");
const task = aws("ecs", "run-task", "--cluster", cluster, "--launch-type", "FARGATE", "--task-definition", output("MigrateTaskDefinition"),
  "--network-configuration", `awsvpcConfiguration={subnets=[${output("TaskSubnets")}],securityGroups=[${output("MigrateSecurityGroup")}],assignPublicIp=DISABLED}`,
  "--query", "tasks[0].taskArn", "--output", "text");
aws("ecs", "wait", "tasks-stopped", "--cluster", cluster, "--tasks", task);
const exit = aws("ecs", "describe-tasks", "--cluster", cluster, "--tasks", task, "--query", "tasks[0].containers[0].exitCode", "--output", "text");
if (exit !== "0") {
  console.error(`Migrations failed (exit ${exit}); see the MigrateLogs log group. The services are unchanged.`);
  process.exit(1);
}
console.log("Migrations applied.");

writeContext((ctx) => { ctx.imageTag = tag; delete ctx.migrationImageTag; });
deploy(`3. API and worker -> ${tag}`);

console.log("\n== 4. live checks");
execFileSync("npm", ["run", "check:live"], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
