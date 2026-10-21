# Private node: minimal profile, private network and Tailscale

This page covers C37–C39. The local free mode does not depend on Cloudum, and a
private-network deployment does not grant plugins any additional capability.

## Minimal runtime (C37)

Use the bounded profile:

```bash
docker compose -f docker-compose.minimal.yml up -d
```

It sets:

- `mem_limit: 2g`, `cpus: 1.0`;
- `PORTALESS_MAX_CONCURRENT_REQUESTS=8` (the Node runtime answers `503 server_busy`
  above the limit instead of queueing without bound);
- `NODE_OPTIONS=--max-old-space-size=1536`;
- a loopback-only published port (`127.0.0.1:3000`).

The image already prunes build-only inputs (`scripts/prune-build-inputs.mjs`) and
runs the private-artifact verifier. To check a prepared runtime tree:

```bash
node node_modules/tsx/dist/cli.mjs scripts/verify-runtime-profile.mjs /app
```

The verifier rejects `.astro`, `docs`, `src/content/pages` and
`src/content/posts` inside the runtime tree, and checks that the private compose
profile has no published app ports, uses an internal network and keeps Tailscale
optional.

## Private network (C38)

```bash
docker compose -f docker-compose.private.yml up -d
```

This profile publishes **no app ports**. The app is only on the internal Docker
network. To reach it remotely, use the optional Tailscale profile:

```bash
export TS_AUTHKEY=tskey-auth-...
docker compose -f docker-compose.private.yml --profile tailscale up -d
docker compose -f docker-compose.private.yml exec tailscale tailscale serve --bg 3000
```

The exact `tailscale serve` command and the tailnet ACL are operator decisions.
The profile does not expose MCP automatically: the MCP HTTP transport is a
separate process/port and must be allowlisted explicitly (see the MCP
interoperability profile at `/.well-known/portaless-mcp.json`).

Tailscale restricts network reachability; it does **not** prove that the host
operator cannot read the mounted volume. Cloudum (if used) must state its
operator access, key custody and backup terms separately.

## Backups and restore (C36)

Create a checksummed backup of the canonical SQLite DB:

```bash
npm run backup
# or: npm run backup -- --dir=/data/backups/manual-1
```

Secrets are excluded by default. The explicit opt-in writes a separate `0600`
file and must not be uploaded or committed:

```bash
npm run backup -- --include-secrets
```

Verify and restore (stop writes on the old node first):

```bash
npm run backup -- verify /data/backups/<id>
npm run backup -- restore /data/backups/<id> --target=/data/portaless.db --overwrite
```

Restore writes a `portaless-writer.json` activation record. The optional
personal-computer copy is a backup/restore target, never a second simultaneous
writer.

## Resource budget (C39)

```bash
npm run test:resources
```

The reference fixture seeds 200 pages × 5 published revisions (1,000 revisions),
measures SQLite, backup and restore, and enforces 2 GiB RSS / 20 GiB disk. The
latest local measurement is in
[`testing/resource-budget.md`](./testing/resource-budget.md). This is a local
reference measurement, not a Cloudum SLA.
