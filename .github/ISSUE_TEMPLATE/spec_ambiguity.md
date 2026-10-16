---
name: Specification ambiguity
about: Report an ambiguous or under-specified point in a Portaless specification (Protocol APW, LTP, the test vectors)
title: "[SPEC] "
labels: spec-ambiguity
---

Reporting an ambiguity is not a complaint — it is how a specification improves.
If you implemented a spec and had to guess, that guess belongs here.

**Which document and section?**
(e.g. Protocol APW v1.3 §5.2; or `APW-VECTORS-v1.3.md`, vector V-06)

**What the spec says** (quote it)


**What is ambiguous**
The specific decision the text does not fix — not "it is unclear", but *which*
choice a reader cannot make from the text alone.

**How you resolved it** (your reading)
What your implementation does and why that reading is the reasonable one.

**Vectors affected, if any**
Which test vectors (V-xx) constrain this, or "none".

**Erratum or new version?**
Your call, and not required to open the issue. The norm: an **erratum**
(`ERRATA.md`, E-1…) carries a normative change without a version bump; a
**version change** is for breaking changes. See the governance process in the
spec.
