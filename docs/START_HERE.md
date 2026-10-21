# Start here — Portaless with three free accounts

> This is the shortest path from zero to a verifiable site you can edit with an
> AI agent. It assumes you want the whole thing (site + agent + trust), and that
> you would rather not read the other 40 documents first. Each step links to the
> detailed guide when you need it.

## The idea in one paragraph

Portaless turns **your content into a site that belongs to you and that anyone
can verify** — no company in the middle. You get a site, a cryptographic
identity for it (Protocol APW), a public trust score (LTP / SiteTrustScore), and
an **MCP server** so an AI agent can edit pages for you. It runs on free
infrastructure: a **GitHub** account hosts the site, **Cloudflare** (optional)
unlocks the dynamic layer and the trust/reputation features, and any **AI with
MCP** (ChatGPT, Claude, Mistral, Perplexity, Cursor, …) becomes your editor.

## The three accounts (all have a free tier)

| Account | What it gives you | Required? |
|---|---|---|
| **GitHub** | Hosts the repo. GitHub Actions builds the site; GitHub Pages serves it for free. | **Yes** — it is where your site lives. |
| **An AI with MCP** | Your editor. Any MCP client: ChatGPT, Claude, Mistral, Perplexity, Cursor. | **Yes** — this is how you edit pages without a terminal. |
| **Cloudflare** | Cloudflare Pages runs the dynamic layer (login, admin, Trust Layer, MCP endpoint) and provides the reputation/crawl infrastructure. | **Optional**, but required for reputation, login and pay-per-crawl. |

## What runs where (so nothing surprises you)

- A **static** Portaless site (home, blog, content pages, `/docs/`) needs **only
  GitHub Pages**. No server, no database, no cost.
- The **dynamic** parts — admin panel, login, SiteTrustScore, the MCP HTTP
  endpoint, pay-per-crawl — need somewhere to run `functions/`. Two free ways:
  **Cloudflare Pages** (edge, recommended) or **self-host** (Node/Docker on your
  machine or a small box).
- The **MCP server** is a small Node process that talks to the same content
  store. You run it locally (or on your self-host) and point your AI client at
  it. It is the bridge between your AI and your site.

## The path

### 1. Put your site on GitHub Pages (static site, ~5 minutes)

1. Fork this repository (or push it to your own GitHub repo).
2. In your repo: **Settings → Pages → Source: GitHub Actions**.
3. (Optional) Set the repo variables `PORTALESS_SITE_URL` and
   `PORTALESS_BASE_PATH` (e.g. `/portaless/` if the repo is not
   `you.github.io`).
4. Push to `main`. GitHub Actions builds and deploys.

Your site is live at `https://<you>.github.io/<repo>/`.
Full guide: [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md).

> Non-technical and prefer Docker + a browser? [`first-steps.md`](./first-steps.md)
> walks the local install with screenshots (Spanish).

### 2. Add Cloudflare Pages (dynamic layer + trust, ~5 minutes)

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** and pick
   your repo.
2. Build command `npm run build`, output directory `dist`.
3. Deploy. Cloudflare gives you `*.pages.dev` with SSL and runs `functions/`.

Now login, the admin panel, the SiteTrustScore pages and the MCP HTTP endpoint
work. This is also where the **reputation** features live (AI-agent
identification with cryptographic signatures, pay-per-crawl, the public
trust score).
Full guide: [`DEPLOY_CLOUDFLARE_PAGES.md`](./DEPLOY_CLOUDFLARE_PAGES.md).

### 3. Connect your AI agent (MCP)

The MCP server exposes 19 tools (`create_page`, `update_page`, `insert_block`,
`apply_theme`, `grant_capability`, …) so an agent edits pages through the **same
permission system** that governs plugins — nothing is bypassed.

Run it against your content store:

```bash
# HTTP transport (recommended: per-invocation agent identity via bearer token)
MCP_AGENT_KEY=<any-key> PORTALESS_SQLITE_PATH=./portaless.db npm run mcp:http
# -> listening on http://127.0.0.1:8788/mcp

# or stdio (for a local desktop client such as Claude Desktop or Cursor)
MCP_AGENT_KEY=<any-key> PORTALESS_SQLITE_PATH=./portaless.db npm run mcp
```

Then add it to your MCP client:

- **stdio clients** (Claude Desktop, Cursor): point the client's MCP config at
  `npm run mcp` in this repo.
- **HTTP clients**: point them at `http://127.0.0.1:8788/mcp` with an
  `Authorization: Bearer <token>` issued from the admin panel
  (`POST /admin/api/mcp-agents`).

Design + security model: [`architecture/mcp-agents.md`](./architecture/mcp-agents.md).

### 3b. Optional: connect an OpenAI-compatible model provider

This is **separate from MCP**. MCP is how an AI client edits your pages; the
OpenAI-compatible provider is a server-side profile for Portaless code that
needs to call a model endpoint. It is an explicit subset, not a claim of
universal compatibility.

Configure it on the server:

```bash
PORTALESS_OPENAI_API_KEY=...
PORTALESS_OPENAI_BASE_URL=https://provider.example/v1
PORTALESS_OPENAI_MODEL=provider-model-name
```

The key stays server-side. Check the active profile as an admin with
`GET /admin/api/ai-provider`. External providers remain **unverified** until a
real key, endpoint and model are tested. Setup, the minimal Python mock and the
external acceptance checklist: [`openai-compatible-provider.md`](./openai-compatible-provider.md).

### 4. Create your first page (the payoff)

Open your admin panel (`/admin`), then ask your agent (via MCP) to create a
page: *"create a landing page with a hero, three features and a contact form"*.
The agent writes a draft; you approve and publish. No terminal, no code.

## What you get out of it

- **A site that belongs to you** — static HTML, no exposed database, portable to
  any host by changing DNS.
- **Protocol APW identity** — a `did:apw` you control (a DNS TXT record + a
  signed manifest), so anyone — human or agent — can verify it is yours without
  asking a company.
- **A public trust score (LTP / SiteTrustScore)** — four sources (`self`,
  `agent`, `community`, `escrow_report`), verifiable, with no central authority.
- **An AI editor that respects your rules** — the agent operates inside the
  permissions you grant, and every invocation is audited.

## Honest limits (read before promising anything)

- The **last step of publishing on GitHub Pages still uses a terminal** for the
  self-host publish flow; the pure static demo does not.
- **Cloudflare Pages OAuth in the wizard is “coming soon”** — connecting the repo
  is done in the Cloudflare dashboard for now.
- The **plugin installer is behind a flag, off by default** (external sandbox
  review pending), and **6 of 12 plugin capabilities** still answer an explicit
  `501` by design.
- **Discovery across nodes has no public endpoint yet** — the mechanism is
  shipped, but there are no peers to federate with.
- This Beta has a **single maintainer** and is **invite-only**; the exit
  criterion (a person outside the project installing it unaided) is **not met
  yet**.
- The full, per-module truth is [`../ROADMAP.md`](../ROADMAP.md) and
  [`../AGENT.md`](../AGENT.md) — this page is the friendly summary, not the
  source of truth.

## Where to go next

| I want to… | Read |
|---|---|
| Install locally with Docker + browser | [`first-steps.md`](./first-steps.md) (Spanish) |
| Deploy the static site | [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md) |
| Deploy the dynamic site (trust layer, login) | [`DEPLOY_CLOUDFLARE_PAGES.md`](./DEPLOY_CLOUDFLARE_PAGES.md) |
| Self-host (Node/Docker/Railway/Render) | [`self-hosting.md`](./self-hosting.md) |
| Understand the AI-agent editing model (MCP) | [`architecture/mcp-agents.md`](./architecture/mcp-agents.md) |
| Connect an OpenAI-compatible model provider | [`openai-compatible-provider.md`](./openai-compatible-provider.md) |
| Write a third-party plugin | [`plugin-author-guide.md`](./plugin-author-guide.md) |
| Understand where the project is going | [`VISION.md`](./VISION.md) |
| Know what is real today, per module | [`../ROADMAP.md`](../ROADMAP.md) |
| Read the Protocol APW specification | [`protocol-apw/APW-SPEC-v1.3.md`](./protocol-apw/APW-SPEC-v1.3.md) |
| Browse every document | [`README.md`](./README.md) |
