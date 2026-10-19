# Disposable staging: local and Docker

The local C04 staging fixture is for host/emulated verification only. It uses
synthetic accounts, documents, markers and credentials; it binds the Portaless
runtime, fake webhook and fake SMTP services to `127.0.0.1`; and it creates a
unique directory under the operating-system temporary directory. It never
mounts the operator's home directory or reads real `.env` files.

## Run the disposable runtime

```bash
npm run build
npm run staging:create
```

The command prints a generated staging ID, loopback URL, temporary data path
and fake provider ports. It does **not** print the synthetic admin password,
webhook token, or encryption key. Press `Ctrl+C` to close listeners and remove
that exact fixture. The browser suite uses the same fixture factory via
`scripts/browser-test-server.mjs`.

If the process is killed before its signal cleanup runs, remove only the
reported fixture by its generated ID:

```bash
npm run staging:destroy -- <staging-id>
```

The destroy command does not accept a filesystem path. It validates the ID,
requires exactly one matching direct child under the staging root, checks a
regular ownership marker, rejects symlinks and removes only that marked
directory. A missing/mismatched marker is an error; it does not broaden the
cleanup target. The staging root itself is never removed.

## Disposable Docker runtime

For container-level acceptance runs, use the Docker profile. It creates a fresh
synthetic DB fixture, a uniquely labeled Docker volume and an `--internal`
network. The Portaless app port and fake webhook inspector are published only
on `127.0.0.1`; the fake webhook and SMTP containers have no external network.
The operator's home directory and credential files are never mounted.

```bash
# Reuse an image already built locally, or omit --image to build a uniquely
# tagged image from this checkout.
npm run staging:docker:create -- --image=portaless:local

# Destroy only resources carrying this generated ID and matching owner labels.
npm run staging:docker:destroy -- <staging-id>

# CI mode: create, exercise and destroy the full fixture in one command.
npm run staging:docker:create -- --image=portaless:local --check-only
```

Creation smoke-checks published/private/draft routes, `llms.txt`, password-reset
delivery to the internal fake webhook, and fail-closed SMTP behavior when the
relay does not offer STARTTLS. The command reports the loopback URL, Docker
network and volume, but never prints synthetic passwords, mail tokens or
encryption keys. A failed cleanup leaves the generated ID and owner marker for
the guarded destroy command; it never guesses resource names or removes an
unlabelled resource.

## What the fixture contains

- A fresh SQLite database with one synthetic admin, one APW identity, one
  published marker page and one draft marker page.
- A synthetic private-archive file and synthetic secret marker in the private
  fixture workspace, outside the built public site.
- A fake local webhook endpoint and fake local SMTP server. They capture
  requests in memory and never forward to the Internet.
- A random encryption key and synthetic provider token scoped to this fixture.

This staging proves local behavior only. It does not authenticate to GitHub,
Cloudflare, ChatGPT or a production mail provider. Real cloud validation needs
dedicated, least-privilege, revocable test credentials supplied through the CI
secret store or a separately approved staging environment; never commit them or
paste them into this guide.
