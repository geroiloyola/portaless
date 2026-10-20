#!/usr/bin/env node
// Disposable Portaless runtime in an internal Docker network. Only the app's
// synthetic data volume is mounted; no home directory or external network is
// available to the containers. Cleanup requires the generated fixture ID and
// both the C04 filesystem marker and Docker resource labels.
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDisposableStaging,
  destroyDisposableStaging,
  locateDisposableStaging,
} from "./disposable-staging.mjs";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DOCKER_MARKER_FILE = ".portaless-docker-staging-owner.json";
const DOCKER_MARKER_KIND = "portaless-docker-staging-v1";
const PREFIX = "portaless-stage";

function docker(args, { capture = false, includeStderr = false } = {}) {
  if (includeStderr) {
    const result = spawnSync("docker", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `docker ${args.join(" ")} failed`);
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
  return execFileSync("docker", args, capture
    ? { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    : { cwd: ROOT, stdio: "inherit" });
}

function emitContainerLogs(names) {
  for (const name of names) {
    const container = inspectResource("container", name);
    if (container) {
      console.error(`[staging:docker] container ${name} state: ${JSON.stringify({
        path: container.Path,
        args: container.Args,
        user: container.Config?.User,
        workingDir: container.Config?.WorkingDir,
        status: container.State?.Status,
        running: container.State?.Running,
        exitCode: container.State?.ExitCode,
        error: container.State?.Error,
        ports: container.NetworkSettings?.Ports,
        mounts: (container.Mounts ?? []).map(({ Destination, RW }) => ({ destination: Destination, writable: RW })),
      })}`);
      try {
        const ports = docker(["port", name], { capture: true }).trim();
        if (ports) console.error(`[staging:docker] published ports ${name}: ${ports}`);
      } catch {}
    }
    try {
      const output = docker(["logs", "--tail", "100", name], { capture: true, includeStderr: true });
      if (output.trim()) console.error(`[staging:docker] logs ${name}:\n${output}`);
    } catch (error) {
      const output = String(error?.stderr ?? error?.message ?? "").trim();
      if (output) console.error(`[staging:docker] logs ${name} unavailable: ${output}`);
    }
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function readDockerOwner(stageDir, id) {
  const markerPath = path.join(stageDir, DOCKER_MARKER_FILE);
  const stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Refusing Docker cleanup: owner marker is not a regular file.");
  const owner = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (owner.kind !== DOCKER_MARKER_KIND || owner.id !== id) throw new Error("Refusing Docker cleanup: owner marker mismatch.");
  return owner;
}

function inspectResource(kind, name) {
  try {
    const raw = docker([kind, "inspect", name], { capture: true });
    return JSON.parse(raw)[0];
  } catch (error) {
    if (/No such|not found/i.test(String(error.stderr ?? error.message))) return null;
    throw error;
  }
}

function verifyResourceLabels(labels, owner, expectedKind) {
  if (labels?.["portaless.staging.kind"] !== expectedKind || labels?.["portaless.staging.id"] !== owner.id) {
    throw new Error(`Refusing to remove unowned Docker resource: ${expectedKind}.`);
  }
}

function removeOwnedDockerResources(owner) {
  for (const [name, kind] of [[owner.app, "app"], [owner.webhook, "webhook"], [owner.smtp, "smtp"]]) {
    const container = inspectResource("container", name);
    if (!container) continue;
    verifyResourceLabels(container.Config?.Labels, owner, kind);
    docker(["container", "rm", "--force", name]);
  }

  const network = inspectResource("network", owner.network);
  if (network) {
    verifyResourceLabels(network.Labels, owner, "network");
    docker(["network", "rm", owner.network]);
  }

  const volume = inspectResource("volume", owner.volume);
  if (volume) {
    verifyResourceLabels(volume.Labels, owner, "volume");
    docker(["volume", "rm", owner.volume]);
  }

  if (owner.ownsImage) {
    const image = inspectResource("image", owner.image);
    if (image) {
      verifyResourceLabels(image.Config?.Labels, owner, "image");
      docker(["image", "rm", owner.image]);
    }
  }
}

async function destroy(id) {
  const stageDir = await locateDisposableStaging({ id });
  const owner = readDockerOwner(stageDir, id);
  removeOwnedDockerResources(owner);
  await destroyDisposableStaging({ id });
  console.log(`[staging:docker:destroy] fixture ${id}, network, containers and owned volume destroyed.`);
}

async function smoke(owner, inspectorToken) {
  const httpChecks = docker([
    "exec", "--env", `PORTALESS_STAGING_INSPECTOR_TOKEN=${inspectorToken}`,
    owner.app, "node", "scripts/staging/docker-http-smoke.mjs",
  ], { capture: true });
  const checks = JSON.parse(httpChecks);
  const smtpProbe = docker(["exec", owner.app, "node", "--import", "tsx", "scripts/staging/docker-smtp-fail-closed-check.mjs"], { capture: true });
  if (!smtpProbe.includes("refused plaintext credentials")) throw new Error("Synthetic SMTP probe did not verify STARTTLS fail-closed behavior.");
  return { ...checks, smtp: "plaintext credentials rejected" };
}

async function create({ image: requestedImage, checkOnly }) {
  const fixture = await createDisposableStaging({ startFakes: false });
  const id = fixture.id;
  const suffix = id.slice(0, 12);
  const ownsImage = !requestedImage;
  const image = requestedImage ?? `${PREFIX}:${id}`;
  const inspectorToken = `STAGING-INSPECTOR-${id}`;
  const owner = {
    kind: DOCKER_MARKER_KIND,
    id,
    app: `${PREFIX}-${suffix}-app`,
    webhook: `${PREFIX}-${suffix}-webhook`,
    smtp: `${PREFIX}-${suffix}-smtp`,
    network: `${PREFIX}-${suffix}-net`,
    volume: `${PREFIX}-${suffix}-data`,
    image,
    ownsImage,
    appPort: await reserveLoopbackPort(),
    webhookInspectorPort: await reserveLoopbackPort(),
  };
  const ownerPath = path.join(fixture.stageDir, DOCKER_MARKER_FILE);
  fs.writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });

  try {
    if (ownsImage) {
      docker(["build", "--label", "portaless.staging.kind=image", "--label", `portaless.staging.id=${id}`, "-t", image, ROOT]);
    } else {
      docker(["image", "inspect", image], { capture: true });
    }

    docker(["network", "create", "--internal", "--label", "portaless.staging.kind=network", "--label", `portaless.staging.id=${id}`, owner.network]);
    docker(["volume", "create", "--label", "portaless.staging.kind=volume", "--label", `portaless.staging.id=${id}`, owner.volume]);
    docker([
      "run", "--rm", "--network", "none",
      "--volume", `${owner.volume}:/data`,
      "--mount", `type=bind,source=${path.join(fixture.stageDir, "data")},target=/seed-data,readonly`,
      "--mount", `type=bind,source=${path.join(fixture.stageDir, "workspace")},target=/seed-private,readonly`,
      "--entrypoint", "node", image, "scripts/staging/seed-docker-volume.mjs",
    ]);

    docker([
      "run", "--detach", "--name", owner.webhook,
      "--label", "portaless.staging.kind=webhook", "--label", `portaless.staging.id=${id}`,
      "--network", owner.network, "--network-alias", `${PREFIX}-webhook`,
      "--publish", `127.0.0.1:${owner.webhookInspectorPort}:4181`,
      "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
      "--memory", "64m", "--cpus", "0.25", "--pids-limit", "64",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
       "--env", `PORTALESS_STAGING_INSPECTOR_TOKEN=${inspectorToken}`,
      "--entrypoint", "node", image, "scripts/staging/docker-fake-webhook.mjs",
    ]);
    docker([
      "run", "--detach", "--name", owner.smtp,
      "--label", "portaless.staging.kind=smtp", "--label", `portaless.staging.id=${id}`,
      "--network", owner.network, "--network-alias", `${PREFIX}-smtp`,
      "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
      "--memory", "64m", "--cpus", "0.25", "--pids-limit", "64",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--entrypoint", "node", image, "scripts/staging/docker-fake-smtp.mjs",
    ]);
    docker([
      "run", "--detach", "--name", owner.app,
      "--label", "portaless.staging.kind=app", "--label", `portaless.staging.id=${id}`,
      "--network", owner.network,
      "--publish", `127.0.0.1:${owner.appPort}:3000`,
      "--volume", `${owner.volume}:/data`,
      "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
      "--tmpfs", "/home/node:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000,mode=700",
      "--memory", "512m", "--cpus", "1", "--pids-limit", "256",
      "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID",
      "--security-opt", "no-new-privileges:true",
      "--env", "PORT=3000", "--env", "HOST=0.0.0.0",
      "--env", "PORTALESS_RUN_UID=1000", "--env", "PORTALESS_RUN_GID=1000",
      "--env", "PORTALESS_SQLITE_PATH=/data/portaless.sqlite",
      "--env", `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY=${fixture.env.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY}`,
      "--env", "PORTALESS_PUBLIC_URL=https://portaless-staging.example.invalid",
      "--env", `PORTALESS_EMAIL_WEBHOOK_URL=http://${PREFIX}-webhook:4180/capture`,
       "--env", "PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT=3",
      image,
    ]);

    const checks = await smoke(owner, inspectorToken);
    if (checkOnly) {
      await destroy(id);
      console.log(`[staging:docker:check] ${JSON.stringify(checks)}`);
      return;
    }
    console.log(JSON.stringify({
      stagingId: id,
      appUrl: `http://127.0.0.1:${owner.appPort}`,
      webhookInspector: `http://127.0.0.1:${owner.webhookInspectorPort}/messages`,
      smtpHost: `${PREFIX}-smtp:2525 (internal Docker network only)`,
      network: `${owner.network} (internal, no Internet egress)`,
      volume: owner.volume,
      image,
      checks,
      destroy: `npm run staging:docker:destroy -- ${id}`,
    }, null, 2));
  } catch (error) {
    emitContainerLogs([owner.app, owner.webhook, owner.smtp]);
    try {
      removeOwnedDockerResources(owner);
      await destroyDisposableStaging({ id });
    } catch (cleanupError) {
      console.error(`[staging:docker] cleanup incomplete; keep this generated ID for guarded recovery: ${id}`);
      console.error(cleanupError?.message ?? cleanupError);
    }
    throw error;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "destroy") {
    const [id, extra] = args;
    if (!id || extra) {
      console.error("Usage: npm run staging:docker:destroy -- <generated-staging-id>");
      process.exitCode = 2;
      return;
    }
    await destroy(id);
    return;
  }
  if (command === "create") {
    const options = { image: undefined, checkOnly: false };
    for (const arg of args) {
      if (arg === "--check-only") options.checkOnly = true;
      else if (arg.startsWith("--image=")) options.image = arg.slice("--image=".length);
      else throw new Error(`Unknown argument: ${arg}`);
    }
    // Fail before allocating a fixture if the daemon is missing/unavailable.
    docker(["info", "--format", "{{.ServerVersion}}"], { capture: true });
    await create(options);
    return;
  }
  console.error("Usage: npm run staging:docker:create [-- --image=tag] [--check-only] | npm run staging:docker:destroy -- <staging-id>");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[staging:docker] ${error?.message ?? error}`);
  process.exitCode = 1;
});
