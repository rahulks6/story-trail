// MEDIA_QUEUE=sqs against a local SQS server (goaws). SQS only wakes workers;
// PostgreSQL holds job state, so lost or duplicate messages are harmless.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const SQS_PORT = Number(execFileSync(process.execPath, ["-e",
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());
process.env.MEDIA_QUEUE = "sqs";
process.env.MEDIA_SQS_ENDPOINT = `http://127.0.0.1:${SQS_PORT}`;
process.env.MEDIA_SQS_QUEUE_URL = `http://127.0.0.1:${SQS_PORT}/000000000000/katkee-media-jobs`;
process.env.AWS_REGION = "ap-south-1";
process.env.AWS_ACCESS_KEY_ID = "katkeetestkey";
process.env.AWS_SECRET_ACCESS_KEY = "katkee-test-secret-not-real";
process.env.MEDIA_STORAGE_ROOT_TEST ??= require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "katkee-queue-"));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { MediaWorker } from "../src/modules/media/worker";
import { jobSignal, setJobSignal, SqsJobSignal } from "../src/modules/media/jobs";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { GOAWS_BIN, jpegWithGps, makeVideo, uploadDirect } from "./mediaHelpers";

const available = fs.existsSync(GOAWS_BIN);
const skip = available ? false : `SQS test server not installed at ${GOAWS_BIN} (scripts/install-media-test-servers.sh)`;
let sqsProcess: ChildProcess | null = null;
let sqsDir = "";
let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();

before(async () => {
  if (available) {
    sqsDir = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-test-sqs-"));
    const configFile = path.join(sqsDir, "goaws.yaml");
    fs.writeFileSync(configFile, ["Local:", "  Host: 127.0.0.1", `  Port: ${SQS_PORT}`, "  Region: ap-south-1", '  AccountId: "000000000000"',
      "  LogToFile: false", "  QueueAttributeDefaults:", "    VisibilityTimeout: 30", "    ReceiveMessageWaitTimeSeconds: 0",
      "  Queues:", "    - Name: katkee-media-jobs", ""].join("\n"));
    sqsProcess = spawn(GOAWS_BIN, ["-config", configFile, "Local"], { stdio: "ignore" });
    for (let i = 0; i < 150; i++) {
      const up = await new Promise<boolean>((resolve) => {
        const socket = net.connect(SQS_PORT, "127.0.0.1", () => { socket.end(); resolve(true); });
        socket.once("error", () => resolve(false));
      });
      if (up) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (sqsProcess && sqsProcess.exitCode === null) {
    sqsProcess.kill("SIGTERM");
    await new Promise((r) => sqsProcess!.once("exit", r));
  }
  if (sqsDir) fs.rmSync(sqsDir, { recursive: true, force: true });
});

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { token: res.body.tokens.accessToken as string };
}

async function waitFor(check: () => Promise<boolean>, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
}

async function queueDepth(): Promise<number> {
  const sqs = jobSignal() as SqsJobSignal;
  const out = await sqs.client.send(new GetQueueAttributesCommand({ QueueUrl: process.env.MEDIA_SQS_QUEUE_URL!, AttributeNames: ["ApproximateNumberOfMessages"] }));
  return Number(out.Attributes?.ApproximateNumberOfMessages ?? 0);
}

describe("SQS job signals", { skip }, () => {
  it("completing an upload sends one wake-up message naming the media", async () => {
    const owner = await signup();
    const sqs = jobSignal() as SqsJobSignal;
    assert.ok(sqs instanceof SqsJobSignal);
    const uploaded = await uploadDirect(baseUrl, owner.token, await jpegWithGps(64, 48, 1), "photo", "image/jpeg");
    const messages = await sqs.receive(1, 30);
    assert.deepEqual(messages.map((m) => m.mediaId), [uploaded.id]);
    for (const m of messages) await m.ack();
    assert.equal(await queueDepth(), 0);
    await query(`UPDATE media_jobs SET status = 'done', finished_at = now() WHERE media_id = :'id'`, { id: uploaded.id });
  });

  it("a worker woken only by SQS processes the job, and drops stale or duplicate messages", async () => {
    const owner = await signup();
    const uploaded = await uploadDirect(baseUrl, owner.token, await jpegWithGps(80, 60, 1), "photo", "image/jpeg");
    // Not due yet, so the worker's first poll finds nothing; its poll loop then sleeps for an hour.
    await query(`UPDATE media_jobs SET run_after = now() + interval '1 hour' WHERE media_id = :'id'`, { id: uploaded.id });
    const worker = new MediaWorker({ store: mediaStorage, workerId: "sqs-worker", concurrency: 1, leaseSeconds: 30, pollMs: 3_600_000, jobTimeoutSeconds: 60 });
    await worker.start();
    try {
      await waitFor(async () => (await queueDepth()) === 0); // the early message is dropped: its job wasn't due
      // Make it due without a NOTIFY; only an SQS message can wake the worker now.
      await query(`UPDATE media_jobs SET run_after = now() WHERE media_id = :'id'`, { id: uploaded.id });
      await (jobSignal() as SqsJobSignal).send(uploaded.id);
      await waitFor(async () => (await queryOne(`SELECT status FROM media WHERE id = :'id'`, { id: uploaded.id }))?.status === "ready");
      await (jobSignal() as SqsJobSignal).send(uploaded.id); // duplicate for a finished job
      await waitFor(async () => (await queueDepth()) === 0);
      await new Promise((r) => setTimeout(r, 300));
      const job = await queryOne(`SELECT count(*) AS n, max(attempts) AS attempts FROM media_jobs WHERE media_id = :'id'`, { id: uploaded.id });
      assert.deepEqual([job?.n, job?.attempts], ["1", "1"], "processed exactly once");
    } finally {
      await worker.stop();
    }
  });

  it("an SQS outage never loses a job: PostgreSQL still has it", async () => {
    const owner = await signup();
    const real = jobSignal();
    setJobSignal(new SqsJobSignal("http://127.0.0.1:9/000000000000/nowhere", "ap-south-1", "http://127.0.0.1:9"));
    try {
      const res = await fetch(`${baseUrl}/api/v1/media/videos`, { method: "POST", headers: { "Content-Type": "video/mp4", ...authHeader(owner.token) }, body: makeVideo({ seconds: 1, width: 160, height: 90 }) });
      assert.equal(res.status, 201, "the upload succeeds even though the signal failed");
      const id = ((await res.json()) as { media: { id: string } }).media.id;
      assert.equal((await queryOne(`SELECT status FROM media_jobs WHERE media_id = :'id'`, { id }))?.status, "queued");
      const worker = new MediaWorker({ store: mediaStorage, workerId: "sweeper", concurrency: 1, leaseSeconds: 30, pollMs: 50, jobTimeoutSeconds: 60 });
      assert.ok((await worker.drain()) >= 1);
      assert.equal((await queryOne(`SELECT status FROM media WHERE id = :'id'`, { id }))?.status, "ready");
    } finally {
      setJobSignal(real);
    }
  });
});
