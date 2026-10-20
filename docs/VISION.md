# Portaless — Vision

> **What this page is.** Where Portaless is going, and what it refuses to become.
> It carries no status, no versions and no dates: what exists today is documented in the repository, and only that documentation is allowed to change weekly. Nothing on this page should need an update because a release shipped.
>
> **Read it as intent.** If this page and reality disagree about *direction*, this page is the direction. If they disagree about *what exists today*, this page is silent on purpose.
>
> **That commitment has a cost, and it is paid in the open.** Changing direction is therefore an act, not a drift: the page is edited, in a visible commit, with the previous version left in history. Direction never changes by quietly building something else — an ignored page and a rewritten page are not the same thing, and only one of them is honest.

---

## The problem worth ten years

Every person and organization now has a digital presence. Almost nobody owns it.

You publish on platforms that can remove, rank, restrict, or silently fail to deliver your work — and the record of what happened disappears along with the decision. Your identity is an account, revocable by someone else's policy. Your audience is a number you cannot verify. Your content is a tenant.

Then came the machines. Automated readers now consume the public web at a volume no human audience ever had, and the tools for a site to say *who may read this, on what terms, and what did they actually do* are practically absent. The web's answer so far has been a text file with no identity attached, and a wave of blocking that punishes readers who meant no harm.

And the CMS that was supposed to fix ownership has a structural flaw of its own: plugins that run with unrestricted access to the core — the documented root cause of the overwhelming majority of its historical vulnerabilities. Extending a site is still the most dangerous thing you can do to it.

Three problems, one shape: **the owner is never the one holding the state.**

---

## The North Star

A **sovereign node**: a person or organization that holds authoritative, verifiable state for the digital presence it is authorized to control, and exposes that state to the rest of the web without asking a platform's permission.

```text
                    PERSON / ORGANIZATION
                             │
                             ▼
                     ┌───────────────┐
                     │     NODE      │  identity · content · policy
                     │               │  evidence · history · control
                     └───────┬───────┘
                             ▼
                     CANONICAL STATE
                verifiable, versioned, portable
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   Identity & evidence   Discovery across   Distribution via
     (Protocol APW)      independent nodes     channels
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                    EXTERNAL PLATFORMS
              social · search · commerce · media
```

The node owns what it is authorized to own. Protocols make that state interoperable and verifiable. Indexes make it discoverable without becoming authorities. Channels carry it outward. Every one of those arrows is a **projection** of the same canon — never a second source of truth.

### The governing principle

> **External platforms are channels, not the canonical source of truth.**

A platform may delete a post, bury a link, change its API, price you out, or shut down. None of that changes what your node knows about what you published, when, and under what terms. That one sentence decides a surprising amount:

- Content removed where it was *distributed* is not the same event as content removed *at home*.
- Nothing in the core may depend on a specific provider staying in business, on the same terms, at the same price.
- Moving to another host or another platform must be an operation, not a migration project.
- Distribution is replaceable by design; evidence of what happened survives the channel that carried it.
- The node can say no. A node that cannot refuse is not sovereign.

### One canon, many projections

The node holds **one** canonical state. Everything it publishes outward — a page, a feed, a manifest, an index entry, a post on somebody else's platform — is a **projection** derived from that state, never a second source of truth. When a projection and the canon disagree, the canon wins and the projection is rebuilt. This is what makes portability an operation instead of a migration project, and it is why no channel, index or marketplace is ever allowed to become the place where the truth lives.

### The shutdown test

Sovereignty is a claim about failure, so it is examined as questions rather than promised as a feature. For each dependency the project takes on, the question needs a written answer:

- What happens if the project's own reference instance, documentation host or repository goes offline?
- What happens if an index operator disappears — or starts lying by omission?
- What happens if a witness goes dark, or one turns out to have been dishonest for a while?
- What happens if a marketplace, a plugin registry or a theme source shuts down?
- What happens if a distribution channel is closed, priced out, or has its API changed?
- What happens if a payment provider, an email provider or an identity provider revokes access?

The acceptable answer is never *"that will not happen"*. It is one of: the node keeps working; the node keeps working with a declared degradation; or the node keeps its evidence and can move to a replacement. A dependency whose failure has no answer is a design defect, not an accepted risk.

---

## What Portaless is

- A self-hostable publishing and site-management system, designed to run without paid hosting and without a database exposed to the internet.
- A local control plane: one place where identity, content, permissions, policy and extensions are decided by the person who owns the site.
- An implementation of an open protocol for cryptographic identity and verifiable evidence — keys, signed statements, key history, third-party observations.
- A foundation for independent nodes to exchange and verify information without a central directory everyone is forced to trust.
- A safe extension surface: third parties can ship capabilities, including closed-source commercial ones, without gaining unrestricted access to the core.
- Deliberately small where smallness is the feature: the core never processes payments, never certifies extensions, never guarantees conclusions.

## What Portaless is not

- Not a claim that the network is already large enough to matter. A network is made of independent operators, not of software.
- Not a replacement for every social, search, commerce, media or identity platform. It is the thing that makes those platforms **optional**.
- Not an authority on truth. It can show who said something and that nothing was altered. It cannot show that the statement is correct, safe, or in good faith.
- Not a certification body for extensions, providers or participants. It exposes evidence; readers decide.
- Not a universal standard for all digital activity — and not a reason to build distributed infrastructure before independent nodes and real use cases exist.
- Not a new center in disguise: a "decentralized" network where every node depends on one hosted service, one index, one marketplace or one signature authority has recreated the original problem one layer up. The project's own instance is a node, not an authority.
- Not a guarantee that any channel will accept, publish or keep what the node sends it.

---

## What cryptography can and cannot claim

Cryptographic evidence is the spine of the trust model, and also its most over-sold part. These six levels are routinely confused, so they are kept apart everywhere:

| Level | What it means |
|---|---|
| **Verified integrity** | The bytes are exactly what was signed. Nothing was altered. |
| **Verified identity** | The signature belongs to the key of the identity that claims it, inside that key's valid window. |
| **Observed evidence** | An independent third party recorded the same thing. |
| **Declared information** | Someone stated it. It may be true, false, or careless. |
| **Derived reputation** | A score computed from evidence under published rules — reproducible, and only as good as its inputs. |
| **Unknown** | No evidence. It is reported as unknown, never as neutral by default. |

Four rules follow, and they are non-negotiable in this project:

1. **A signature is not truth.** It proves control of a key, not the accuracy of a claim.
2. **A declared origin is not a detection.** Presenting a declaration as a verified fact is a defect, not marketing.
3. **A default must never quietly stand in for missing evidence.** An empty network scores nothing; it does not score neutral.
4. **Verification fails closed** where the protocol requires it — and where it cannot verify, it says which of the six levels it reached.

### Evidence first, score second

Interfaces show **what is known and what is not**, before they show a number. An aggregate without the count and the weight behind it is decoration; a default rendered as data is a claim nobody made. Where evidence is absent, thin or contradictory, the interface says so, and a neutral value never stands in for a measurement that was never taken. A score is a reading of evidence — it is never the evidence itself, and it is never the whole story.

> **Mathematical trust is never projected without cryptographic evidence.**

A derived score is a *projection* of what the protocol could actually verify — issuer identity, a signature valid for its key window, chained history and the source's declared provenance — not a substitute for any of it. When that evidence is absent the projection says *pending*; when it is thin the projection says *inference*; and it never presents the neutral prior as if someone had measured it. This is the rule SVRI (Score de Verificación y Razonamiento de Inferencia) makes explicit: the number travels with its provenance and with the share of the result that is mathematical inference rather than observation. A reader-facing surface may show only the qualitative level, but it may never show that level as if the evidence behind it were stronger than it is.

---

## Identity must be proportionate

Demanding cryptographic identity everywhere does not make a system safer; it makes it unusable and pushes people toward the easiest bypass. The model is proportional, in both directions:

- **Reading public content requires no identity at all.** A public page stays public, and no reader — human or machine — has to reveal who it is to read what a site chose to publish.
- **A declared identity is what a machine reader needs when a site has said it wants to know who is reading and on what terms.** The cost of that identity is a key the reader already holds, not another account with another company.
- **The higher the value of the operation, the stronger the proof.** Publishing, granting a capability, changing policy, rotating an identity or moving money may require a second factor, a recent authentication, or an explicit human approval — because that is where the damage would be.
- **The protocol decides what can be verified, never what must be demanded.** A site's policy may be stricter than the default; it may not be more permissive than what can actually be checked.

Anything that demands identity to *read* is a product decision, argued in the open — never a quiet default.

---

## The rule that decides what gets built

> **Do not build infrastructure for a network that does not yet exist. Build the smallest interoperable capability that allows the next independent operator to join.**

Every proposal is classified before it is argued about:

| Class | Meaning | Rule |
|---|---|---|
| **Now** | A concrete product gap, a correctness bug, a security risk | Build it and verify it |
| **Enable** | A small reusable capability that removes a real barrier for the next participant | Build it when a specific next step needs it |
| **Gated** | Requires independent operators, real evidence, external providers, or observed demand | Define the gate first; never simulate completion |
| **Out of core** | A commercial service, a specialist product, an optional integration | Separate project, provider, or plugin |

A gate is not a ban on working on something. It is the evidence that must exist before the project **claims** it, **promises** it, or **leans** on it. Announcing an outcome that no evidence supports is the one thing this project treats as a defect rather than a marketing decision.

---

## Three horizons

Horizons are evidenced, not dated. This project has one maintainer and will not put a calendar on a promise.

**Horizon 1 — A node one person can actually run.**
The measure is not a feature list. It is that someone who does not write code installs it, publishes a site, holds an identity they own, and gets a real answer to *which automated readers may access this, on what terms, and what did they do*. Publishing must not require a terminal, and the honest limits of any given host must be visible up front instead of discovered later.

**Horizon 2 — A standard more than one implementation speaks.**
The line between "our software" and "a protocol" is a second implementation, written by someone who read the specification and not the source. Identity resolves between sites that have never met. Signed evidence verifies without asking the issuer. Given the same signed evidence, an independent party recomputes the same ordering — because the rules are published, not because it trusts the software that produced them.

**Horizon 3 — A network with no center.**
Independent operators, each sovereign over its own state. Indexes and directories that verify what they relay instead of being trusted for relaying it. Discovery across nodes whose operators have no relationship with each other. Distribution channels that are interchangeable because none of them holds the original. Commercial modules running above the core without changing its license or its release cycle.

---

## What success looks like

The shift is real when:

1. People and organizations control the nodes that hold their state, and can leave any platform without losing it.
2. The protocol is implemented and verified by parties independent of its authors.
3. Trust evidence is attributable, reproducible, and explicit about what it does not know.
4. Discovery works across independently operated nodes, with no central authority deciding what exists.
5. Cross-node state problems are solved because they were observed, not because they were imagined.
6. External platforms are replaceable channels rather than the source of truth.
7. Extensions and commercial services participate without compromising the core's boundaries or its license.
8. The network can grow without the original author approving each step or remaining its single point of failure.

The last one is the real test. **A vision that requires its author is not a vision; it is a dependency.**

**The test underneath all of them: two strangers.** Two people who have never met, with no shared platform, no common provider and no reason to trust each other yet, can exchange something of value — a citation, an audience, a review, a reader, a payment — with less blind trust than either of them needs today, and without asking the other's platform for permission. Decentralization was never the point in itself: the point is **reducing the amount of blind trust required to cooperate**. A network that merely moves the trust from a large platform to a small one has changed the owner, not the problem.

---

## What we will not build

Not because these problems are unimportant, but because building them early would be pretending to solve something for which no evidence exists yet:

- A universal canonical-state schema for arbitrary resources.
- A general-purpose reconciliation or distributed-consensus engine; an arbitration layer for disputes that have not occurred; zero-knowledge infrastructure without a specific privacy requirement.
- Universal syndication across every external platform, advertised before each channel is verified on its own.
- Global rankings without shared semantics and independent evidence.
- Large-scale gossip or consensus machinery beyond what verified indexes actually require.
- A marketplace economy before independent extension authors and users demonstrate demand.
- Automated media-origin detection presented as a capability while the metadata remains declarative.
- Claims of reach, streams or engagement that the underlying providers do not expose.

Deferral is a sequencing decision, not a statement that the problem does not matter — and it is reversible the moment its gate is met.

---

## Who this needs

- **Operators** who want their presence to be theirs: install it, publish, decide who and what may read it.
- **Implementers** who will read the protocol and build it again in another language, another stack, another company — and say where the specification was ambiguous, because that is how a specification improves.
- **Extension authors** who want to ship capabilities, including commercial and closed-source ones, without touching the core or inheriting its license.
- **Reviewers** who take apart the two highest-damage surfaces — how a person proves who they are, and how third-party code is contained — and publish what they find.
- **A second maintainer** with real merge authority, so the project stops depending on one person's calendar. This is not a nice-to-have: an open project with a single point of failure should not be asking strangers for production data.

---

## The standard this project holds itself to

Fewer isolated portals. Fewer accounts on infrastructure you do not control. More real ease to build the places worth building — and a web where the people who make things can prove what they made, without asking anyone's permission.
