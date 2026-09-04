---
version: "0.1.0b"
created_at: "2026-09-04T09:00:00+07:00,Claude Code"
last_update: "2026-09-04T09:00:00+07:00,Claude Code"
status: "accepted"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "architecture-decision"
  scope: "Pull-model edge execution of asset evidence extraction, device credential boundary, lease and idempotency, evidence-byte service and provider selection"
---

# ADR-059 — Edge-executed evidence extraction (pull model)

**Amends ADR-056 D4** (which named the extraction provider) and **applies
ADR-041 D3** (zero edge secrets in the cloud) rather than restating it.

## Status

**Status:** Accepted 2026-09-04 — owner-instructed. The declaration (requirements,
feature notes, charter ownership, wire contract) lands with this decision;
implementation follows in separate lanes. Production migration is **not** part of
this wave.

## Context

`src/modules/asset-management/infrastructure/openai-asset-evidence-extractor.js`
(FR-138, ADR-056 D4) calls OpenAI's Responses API with a **platform** API key.
That works, and it has two properties the owner does not want to keep paying for:

- every page of every receipt a customer uploads leaves the customer's premises
  and is billed to the platform's provider account;
- the platform holds one key whose blast radius is every Business at once.

The Zuri Edge Device (ADR-041) already exists to run local LLM daemons on customer
premises under its own subscription-based auth. Moving extraction onto it removes
both properties at once — the customer's own hardware, the customer's own model,
the customer's own subscription — and leaves the cloud holding no inference
credential at all.

The obstacle is direction. The device sits on a customer LAN behind NAT, and since
ADR-058 the cloud application itself may run on a VPS **or** on-premise under
Docker Compose + ngrok, so there is no stable cloud→device path to open and no
reason to invent one. Every design that has the cloud call the device requires
either an inbound tunnel per customer site or a device-hosted public endpoint,
both of which put an edge secret or an edge address into the cloud's hands —
exactly what ADR-041 D3 forbids.

There is also a narrower fact worth recording, because it is what makes this
decision cheap: FR-138 already ends at a **candidate**. The extractor's contract
is one validated `zCandidate` object; nothing about that contract says which
machine produced it. Only the transport is being replaced.

## Decision

### D1 — Pull, not push

The cloud never initiates a connection to a device. It **queues** an
`AssetExtractionJob` and the device **claims** it over an outbound HTTPS request
it opens itself. Claim, evidence download, complete and fail are four calls in
the same direction, so a device needs no public address, no inbound firewall rule
and no tunnel, and the cloud stores nothing that could be used to reach it.

The cost is honest and stated: latency is bounded below by the device's poll
interval, and a Business with no device online leaves jobs QUEUED indefinitely.
The console shows the job state for exactly that reason (FR-143), rather than
pretending an extraction is in progress.

### D2 — The credential boundary

Device authentication is a **new, Business-scoped** credential family,
`EdgeDeviceCredential` (FR-144), not a reuse of FR-106's Tenant-bound
`ApiAccessKey` and not a plugin session (FR-123). The three answer different
questions — "which Tenant's Enterprise API caller", "which installed plugin's
user", "which device at which Business" — and collapsing them would let one
leaked credential satisfy a check it was never issued for (the ADR-047 D2
reasoning, applied a third time).

Its boundary:

- **Hash-only.** The raw `edgk_…` key appears exactly once, in the mint response.
  The database holds a SHA-256 `keyHash` and a short display `keyPrefix`. There is
  no read path, no "reveal", no recovery — a lost key is re-minted.
- **Business-scoped.** A credential names one Business and one `deviceId`. It can
  claim, download and complete only that Business's jobs.
- **Mint-once, revocable.** `status` is ACTIVE or REVOKED with `revokedAt` and
  `revokeReason`; revocation is immediate and `lastUsedAt` records the last
  successful resolution.
- **404-shaped refusals.** Mint, list and revoke answer a Business the viewer does
  not own with the same 404 a nonexistent Business receives — the FR-072
  discipline, so the surface is not an ownership oracle.
- **One generic 401.** `resolveEdgeDeviceContext` cannot distinguish, in its
  response, between a missing header, a malformed key, an unknown key, a revoked
  key and a key belonging to another credential family.

### D3 — Lease and idempotency

A claimed job carries a `leaseExpiresAt` **10 minutes** ahead. Three rules follow,
and each exists because of a specific failure:

- A CLAIMED job whose lease has expired returns to QUEUED and may be claimed
  again — because a device that loses power mid-job must not strand the evidence
  forever.
- `complete` and `fail` are idempotent **per job `version`** — because the device
  will retry a request whose response it never received, and a retry must not
  produce a second candidate or a second audit event.
- A COMPLETED job is never re-claimed and never re-completed — because a late
  reply from a device whose lease already expired must not overwrite the result of
  the device that actually finished the work.

Claim order is oldest-QUEUED-first, scoped to the Business of the presented
credential, so one Business's backlog cannot starve or observe another's.

### D4 — Evidence bytes are served by the cloud, to the lease holder only

The device downloads evidence from the cloud
(`GET /api/edge/extraction-jobs/{id}/evidence`), which streams the bytes with the
`FileAsset` MIME **only** while that job is CLAIMED by that device under a live
lease. The cloud never hands a device a bucket URL, a signed storage link or a
storage credential — that is ADR-041 D3 read in the other direction: the edge
holds no cloud secret either. SEC-024's "authorize scope before bytes" rule is
unchanged and now has a second caller.

### D5 — Provider selection

`ZURI_ASSET_EVIDENCE_PROVIDER` accepts `openai` or `edge`, and an explicit value
**wins**. When unset, the default is `edge` if no `OPENAI_API_KEY` is configured
**and** the Business has at least one ACTIVE `EdgeDeviceCredential`; otherwise
`openai`.

The default is written this way round deliberately. An installation that has
configured an OpenAI key has said what it wants and keeps getting it; an
installation that has paired a device and has no platform key would otherwise get
a 503 from an adapter it never intended to use. The OpenAI adapter is **not**
removed or deprecated — FR-138 stands unchanged and stays selectable, because a
Business with no device is still a supported Business.

### D6 — The runtime lives in the other repository

The daemon that actually runs the local model is `zuri-edge-device` work, not
zuri-ai work. This repository ships two things and stops:

- `contracts/edge-extraction-job.schema.json` (+ an example) — the wire contract
  the edge repository codes against, versioned here because the cloud owns the
  job's shape;
- `scripts/edge-extraction-poller.mjs` — a reference poller with a pluggable
  `extractCandidate(bytes, mime)` hook whose default stub returns a schema-valid
  empty candidate at confidence 0 and provider `edge-stub`, so the loop is
  runnable and testable before any model exists. It reads
  `ZURI_CLOUD_BASE_URL` and `ZURI_EDGE_DEVICE_KEY` from the environment and never
  logs the key.

## Consequences

**Accepted:**

- Two new models, both additive: `EdgeDeviceCredential` (identity) and
  `AssetExtractionJob` (asset-management). The Supabase migration is written under
  `supabase/migrations/` following the plugin-auth template and is **not applied**
  to production in this wave; the gate stays open and is named in both feature
  notes.
- Extraction becomes asynchronous on the edge path. `POST .../extract` answers
  `202` with a job instead of a candidate, and the review surface polls
  `GET /api/assets/evidence/{id}/extraction-job`. The OpenAI path keeps its
  synchronous shape, so two response shapes exist behind one route — stated here
  rather than hidden behind a uniform envelope that would make the openai path
  lie about being asynchronous.
- The `/platform/integrations` Edge tab's client-side "pairing key/secret
  generator" is deleted. It produced `tok_edge_` / `sec_edge_` strings no server
  ever stored — a control that has always done nothing, which is a false claim
  about a security boundary and the more urgent half of this change.
- FR-141's open "device-scoped credential" item closes: the heartbeat `POST`
  accepts this credential, and the device context supplies `businessId`.

**Not decided here, deliberately:**

- Whether device liveness must persist. FR-141's registry stays process-local; a
  credential is a durable record, a heartbeat still is not.
- Job cancellation policy beyond the CANCELLED state existing — who may cancel a
  claimed job, and whether a cancel revokes a live lease, is an implementation
  question the lanes may answer conservatively (owner-only, no lease revocation).
- Any change to what a candidate means. BR-025 stands: extraction proposes,
  a human reviews, and no provider — cloud or edge — approves anything.

## References

- ADR-041 — Zuri Edge Device, D3 (zero edge secrets in the cloud)
- ADR-056 — Asset evidence cloud and extraction boundary, D4 (amended here)
- ADR-057 — Asset evidence production deployment and migration boundary
- ADR-058 — Docker Compose + ngrok replace Vercel
- ADR-047 D2 — a credential must not satisfy a check it was not issued for
- FR-143, FR-144, SDD-085, SEC-025, FEAT-017, BR-025, SEC-024, FR-141, FR-138
