---
domain: integration
feature: FR-130
module: integration
source: v2-native
version: "0.2.0b"
status: "partial"
---

# FR-130 — GitHub repository binding and read-only projection

## Intent

A Business registers the repository its work lives in, and a person that
Business admits can read that repository's tree and files inside the console
instead of leaving for GitHub. The register half has shipped since FR-008; the
read half is what FR-130 declares, and it is declared **blocked** — on a
data-protection question rather than on effort. That blocker is the reason this
note exists at all, and it still stands.

The requirement is `partial` rather than `declared` because one thing in it was
never behind that blocker: the console was already asserting a GitHub connection
that does not exist. That is corrected, and nothing else is built — the next
section says exactly what changed and why it stops there.

## What is built (2026-08-30), and what is still blocked

**Built: the catalog no longer claims a connection that does not exist.** That
is the whole of it, and it is deliberately the whole of it — the projection, the
webhook adapter and making `ProjectRepository.pathScope` load-bearing all sit
behind the blocker below and none of them was started.

`src/platform/integrations/core/connector-catalog.js` now holds the connector
list, and an entry **cannot carry a state**: it names the
`IntegrationProvider.code` values a connection for it would have, and
`deriveConnectorStatus` computes the state from the rows
`listPhase1Integrations` already returns — the same read model the connection
list further down the page renders. The page imports the derivation; nothing in
the catalog asserts.

What the correction found, which is more than the finding above stated:

| Entry | Old literal | Derived today | Why |
|---|---|---|---|
| GitHub Repositories | `CONNECTED` | `NOT_CONNECTED` · `CONNECTOR_NOT_IMPLEMENTED` | nothing in `src/` speaks to GitHub; `github` appears only as a `provider` string option on `/repositories` |
| Vercel Ingress & Webhooks | `CONNECTED` | `NOT_CONNECTED` · `CONNECTOR_NOT_IMPLEMENTED` | `/api/agent/line-webhook` is the only webhook receiver that exists |
| LINE Official Account | `CONNECTED` | its `LINE_OA` connection's health, or `NO_CONNECTION_RECORDED` | connectable, but the literal was green for a Business that had never configured it |
| OpenRouter (LLM Models) | `CONNECTED` | its `openrouter` connection's health, or `NO_CONNECTION_RECORDED` | same |
| Google Gemini | `AVAILABLE` | its `gemini` connection's health, or `NO_CONNECTION_RECORDED` | wrong in the **other** direction: `gemini` is in `PUBLIC_LINE_PROVIDERS`, so the Phase 1 model form could always connect it |
| Slack, Notion, Microsoft 365, Gmail, Google Calendar, Google Drive | `AVAILABLE` | `NOT_CONNECTED` · `CONNECTOR_NOT_IMPLEMENTED` | `AVAILABLE` reads as an offer; there is nothing to press |

Two smaller consequences follow from the same rule rather than from taste. The
**"Connect" button is gone** from an entry with no connector: a control that
does nothing is the same false claim moved one element to the right. And the
hand-written Slack and Notion cards in the "Popular" strip say `Not connected`
too, because a surface that offers Connect in one panel and reports "no
connector in the system" in another is disagreeing with itself.

`AVAILABLE` was not replaced with a friendlier word. The two reason codes keep
apart two facts it had merged — `CONNECTOR_NOT_IMPLEMENTED` (there is nothing to
configure) and `NO_CONNECTION_RECORDED` (there is, and this Business has not) —
and a connection row that arrives without computed health resolves to
`NOT_CONNECTED`, not to the green the literal used to give for free.

The rule this follows was already written in this lane, one file away, about a
single connection: `connection-health.js` says a stored status "is a claim that
was true once, and the failure mode is a dashboard that says CONNECTED while
every event is failing". A literal in a catalog array is that claim without even
the once.

**Still blocked, unchanged:** everything in "The PII question" below. Nothing
here touched `Repository`, `ProjectRepository`, `DATA_LANES`, the schema or any
requirement id, and **no attestation shape was invented** — see the next
section.

### Why this PR did not build the attestation shape

It was asked directly, and the answer is no, on the code rather than on
preference.

FR-129 is not the parallel it looks like. There the column existed —
`PipelineGateDecision.evidenceJson` had been in the schema and in production DDL
since FR-071, hardcoded to `'{}'` by its only writer — so making it writable
closed a gap somebody had already designed and shipped half of. The shape was
decided; only the write path was missing.

Here nothing exists. There is no column, no model, and no policy. `SEC-005`
consent attaches to an FR-023 `Customer` row, and there is no row here to attach
an assertion to. `AuditEvent.action` is a plain `String`, so a value *could* be
written — which is exactly the trap: a free string nobody validates, nothing
reads and no rule governs is a note, not a control, and it would be indexed and
displayed as though it were one. Inventing one would mean choosing, silently
and by omission, who may declare a path free of personal data — the same move
FR-129 explicitly refused when it declined to expose an approval route under
scope-level admission alone, and for the same reason: an authorization policy
chosen by omission is cheaper to add later than to narrow. A form people can
fill in meaninglessly is worse than an honest absence, because it produces a
record that looks like a control.

The blocker is a decision. A decision is not unblocked by building a form for it.

## What already exists, which is nearly all of the binding

This is the part CR-004 and the review in `docs/change-requests/README.md` both
missed, in opposite directions. CR-004 proposed five columns on `Business`. The
review refused them and pointed at `IntegrationConnection`. **Neither is where
this belongs**, because a repository record already exists:

```prisma
model Repository {
  id             String   @id @default(uuid())
  code           String   @unique
  businessId     String?          // FR-073 — owned by exactly one Business
  provider       String           // 'github' is already the UI's default option
  externalRepoId String?          // GitHub's numeric id, mapped not keyed (BR-002)
  ownerName      String?
  repoName       String?
  fullName       String?
  url            String?          // ← CR-004's githubRepoUrl
  defaultBranch  String?          // ← CR-004's githubBranch
  status         String   @default("ACTIVE")
}
```

It is not an unused shape. `/api/repositories`, `/api/repositories/[id]`,
`/api/repositories/link` and `/api/repositories/link/[id]` are live and
viewer-scoped; `createRepository` requires `ownsBusiness` and `listRepositories`
filters by `seesBusiness` (FR-073); `/repositories` renders it with a provider
dropdown whose **default option is already `github`**; and
`ProjectRepository` carries a per-project `branch` and `pathScope` beside the
link's `role`.

The page even states the gap in its own subtitle, and has since it shipped:

> Local metadata only — provider, name, URL, default branch. No GitHub API
> access in MVP.

That sentence is FR-130's scope, written by the surface that lacks it.

### The mapping from CR-004's proposal

| CR-004 field on `Business` | Where it already lives |
|---|---|
| `githubRepoUrl` | `Repository.url`, beside `ownerName` / `repoName` / `fullName` |
| `githubBranch` | `Repository.defaultBranch`; `ProjectRepository.branch` overrides per link |
| `lastCommitSha` | **not stored** — see below |
| `lastGithubSyncAt` | **not stored** — see below |
| `githubSyncStatus` | **not stored** — see below |
| — (unstated) the GitHub repo id | `Repository.externalRepoId` + `ExternalEntityRef` (BR-002) |
| — (unstated) a private-repo token | `IntegrationCredential.secretRef` (SDD-043, SEC-015) |

So FR-130 declares **no model, no column and no migration.**

### The three sync fields are not relocated — they are not needed

The easy answer is that `lastCommitSha` is `SyncCursor.cursorValue`,
`lastGithubSyncAt` is `SyncCursor.lastSuccessAt` and `githubSyncStatus` is
`IngestionRun.status`. That answer is available and it is not the right one.

All three describe **a mirror kept in step with an origin**. A read-through
projection keeps no mirror: the tree comes from a live fetch, so the commit a
reader is looking at is already in that response. Storing it would be a second
answer to a question the response carries — the same objection FR-129 raised
against a stored `vaultId`, and the reason a `progressCache` here is advisory
rather than authoritative.

If a cache is added later, those three columns *are* where the facts go. That
is also the moment to settle a keying question rather than inherit it:
`SyncCursor` is unique on `(connectionId, resourceType)`, so **one connection
covering several repositories has no per-repository cursor** without either
compounding an id into `resourceType` or narrowing a connection to a single
repository. `IntegrationConnection.externalAccountId` names an *account*, not a
repository — which is precisely why `Repository` is a separate model. Anyone
adding the cache must choose deliberately; nothing here has chosen for them.

### Why not on `Business`, and why not on `IntegrationConnection` either

`Business` is refused for the reason the review gave and one it did not:
BR-002 names "GitHub id" in its own example list, so a foreign URL and commit
SHA on a scope-chain row is the case that rule was written for — *and* columns
on `Business` would cap a Business at exactly one repository, where
`Repository` has always permitted many and `ProjectRepository` already fans them
out across projects.

`IntegrationConnection` is refused because it is not a repository. It is
provider-neutral connection state (FR-079) keyed
`@@unique([tenantId, providerId, externalAccountId])` — "this tenant binds this
external account at this provider". A GitHub *account or App installation* is
that; a *repository under it* is not, and one connection fans out to many
repositories. Building the binding there would have produced a second
repository record beside the one that has existed since FR-008 — the same
second-source-of-truth defect the CR-003 erratum caught the review committing
once already.

What `IntegrationConnection` legitimately owns here is real and necessary: the
credential (`IntegrationCredential.secretRef`, material never in Prisma and
never in a browser response) and the identity a webhook delivery resolves
against.

## The webhook: the two things CR-004 left out

CR-004 proposes `/api/webhooks/github` with no tenant and no authentication.
Both are resolved here rather than restated, and the endpoint itself is refused.

**It is an adapter, not an endpoint.** FR-081 names four `SOURCE_TYPES` —
`PULL`, `WEBHOOK`, `FILE`, `MANUAL` — and requires every acquisition channel to
converge on one normalized envelope, adding "an adapter rather than a second
raw-write path". A bespoke `/api/webhooks/github` is precisely the second path,
the same finding CR-005's LINE connector drew. It also lands in the wrong lane:
`src/app/api/**` resolves to the project-manager charter, while an ingestion
adapter belongs under this domain's `src/app/api/platform/integrations/**`.

**Tenant comes from the binding, never from the payload.** The delivery's
`installation.id` selects an `IntegrationConnection` on
`(providerId = github, externalAccountId)`; **zero or multiple candidates fail
closed**, which is FR-079's own rule for connection selection and not a new
invention. The selected connection carries the trusted `tenantId` and
`businessId`. Only then does `repository.id` resolve to a `Repository` through
`ExternalEntityRef`. The payload's `repository.full_name` is never a key
(BR-002). This is the same shape FR-052 uses for LINE: a server-owned binding
resolves scope, and a client-supplied scope is rejected before persistence.

**Authentication is the signature, verified first.** GitHub signs every
delivery with `X-Hub-Signature-256`, an HMAC-SHA256 over the raw body under the
webhook secret; the secret is an `IntegrationCredential.secretRef` resolved
through the `SecretManagerPort`, and the comparison is constant-time. Ordering
is part of the requirement, not an implementation note: routing reads
`installation.id` and nothing else, which is a non-secret selector the signature
subsequently proves, so nothing is written and nothing is interpreted before
verification succeeds. That is FR-123/SEC-022's structure — parameters read only
from something already proven — applied to a different signer.

## The persistence boundary (SDD-076)

**Push metadata persists. File content never does.**

FR-081(c) makes verbatim persistence the rule for every acquisition channel:
raw payloads are replayable evidence, translated by a separate later path. A
push delivery fits that exactly — head SHA, changed paths, actor, timestamps
become a `RawExternalRecord` under the one envelope with `sourceType: 'WEBHOOK'`,
and `SyncCursor.cursorValue` advances to the new head.

Blob content does not, and this is the first channel where following FR-081(c)
literally is the defect rather than the discipline. A bound repository is an
arbitrary external tree. Persisting its files would put whatever they contain
into `RawExternalRecord` — a table the erasure path has no route to. FR-022
erases through `Person`/`Customer`; SEC-005 consent is attested on the FR-023
`Customer` row per Business (SDD-053). Rows inside a spreadsheet inside a blob
have neither, so the record would be personal data that is unconsented and, by
construction, unerasable.

That carve-out is written down precisely because it contradicts the default a
reader will find first. Someone who reads FR-081(c) and not SDD-076 will
persist the blobs, correctly citing the requirement.

## The PII question, which is the blocker

CR-006 is not background here; it changes what this requirement can claim.

The repository CR-004 names held three spreadsheets of real customer data — a
contact list for a named legal entity, a quotation report, and per-customer
purchase history — **tracked in git, on a public remote**, verified four ways
on 2026-08-30. The repository is private now and the files are untracked, but
the history retains them. Throughout, `git status` reported nothing wrong,
because a tracked file with no local edits is neither untracked nor modified.

A Files tab renders whatever the bound repository's tree contains. So the
question this requirement has to answer is not "did that repository get
cleaned" but "what happens when a bound repository holds data this system's own
PDPA controls would never admit through the front door".

Two controls answer part of it:

1. **Nothing is stored.** Read-through only (SDD-076), so there is no
   unerasable copy and no second store of personal data.
2. **Deny-by-default path scope.** The projection reads only paths a binding
   declares, in the shape SEC-009 already applies to LINE knowledge access —
   server-only, allow-listed, PII excluded. `ProjectRepository.pathScope` is the
   field that carries such a scope and is already threaded end-to-end (input
   schema, service, read model, a UI pill, plan and xlsx import). **Nothing
   treats it as a boundary today** — it is descriptive metadata, and making it
   load-bearing is a change in the field's meaning, stated here rather than
   assumed. CR-006 §5.2's exclusion of `vaults/` falls out of the same
   mechanism: live database state is not a document, and reading a WAL
   mid-write is worse than useless.

Neither answers the third thing, and it is the blocker:

> **Nothing in this repository can determine whether a declared path contains
> personal data, and there is nowhere to record an assertion that it does not.**

Whoever binds a repository is asserting something about its contents that
zuri-ai cannot verify. SEC-005 consent attaches to a `Customer`; there is no
attestation shape for "this path holds no personal data", no policy for who may
make one, and no audit event that would carry it. Until that exists, a
projection is a disclosure surface with no consent record — every viewer holding
`seesBusiness` on the bound Business reads whatever the tree holds, under
zuri-ai's access control rather than GitHub's.

**Remediating CR-006's instance does not lift this.** Cleaning that one
repository removes today's example; the next bound repository has the identical
unverifiable property. The blocker is structural, so FR-130 is declared blocked
in the sense FR-121 is — on a named, checkable thing rather than on effort.

Honest about the limits of control 2 as well: changed *paths* are metadata, but
a path can itself be personal data. CR-006 declines to reproduce the filenames
it found for exactly that reason. So the metadata lane is bounded by the same
path scope and is not clean merely by being metadata.

## What is deliberately not in scope

**The four-part UI.** CR-004 §2.B asks for a collapsible recursive tree,
purpose badges, a multi-format previewer (Markdown with Mermaid, syntax-
highlighted code, a `.jsonl` audit table, PDF and image viewers) and a file
metadata panel. That is a feature programme spanning several requirements and
several unmade product decisions, and it is downstream of a blocker that would
make building it wasted work. FR-130 is the binding and the read contract the
eventual explorer would call; it is not that explorer.

Also note the surface CR-004 proposes does not match this shell:
`/platform/**` is the Platform admin sub-domain — its five children are
`integrations`, `customer-import-reviews`, `users`, `sot-pipeline` and
`product-readiness` — not a workspace surface, and workspaces live at
`/workspaces/[workspaceId]`. A Files tab also already exists: FR-045's Business
File Manager at `/files`, over `FileAsset`. Where a repository projection sits relative to that is a product
question this requirement does not settle.

## Smaller things this requirement must correct rather than inherit

- **`DATA_LANES` has no honest value for a source repository.** The six lanes
  are business-semantic (`ACCOUNTING`, `SALES`, `PRODUCTION_SUPPLY`,
  `MARKETING`, `CUSTOMER`, `BUSINESS`) plus `MARKET_INTELLIGENCE`. Classifying a
  repository push as `BUSINESS` would make the acquisition provenance lie about
  its semantic lane — which is the exact argument ADR-038 made when it added
  `MARKET_INTELLIGENCE` rather than reusing one. Adding a lane costs no
  migration (`lane` is a plain `String` column) but it is that decision, made
  once, not a free enum edit.
- ~~**The integrations catalog already claims GitHub is connected.**~~
  **Closed 2026-08-30** — see "What is built" below. The finding was correct and
  narrower than the reality: the tile was one of **four** entries hardcoded
  `status: 'CONNECTED'`, and it was not the only impossible one.

## Boundaries

`Repository` and `ProjectRepository` are claimed by the **project-manager**
charter, not this one, and FR-130 does not change that. This lane reads those
models and calls project-manager's `repository-service`, which remains their
only writer — the same "using the ledger is not owning it" rule this charter
already states in the other direction for the six `Pipeline*` models.

## Related

- FR-008 — the `Repository` record and its many-to-many project links.
- FR-073 — Repository ownership: one Business, `ownsBusiness` to write, `seesBusiness` to read.
- FR-079 — connection selection, and the fail-closed rule on zero or multiple candidates.
- FR-081 — the one ingestion envelope a webhook adapter converges on.
- FR-045 — the Files surface that already exists, over `FileAsset`.
- FR-022 / FR-103 / SEC-005 — the erasure and consent controls a projection must not bypass.
- SEC-009 — the deny-by-default, allow-listed shape the path scope follows.
- SDD-076 — the persistence boundary and the rejected `Business` columns.
- `docs/change-requests/CR-004-ACCEPTED-SHAPE.md` — the reworked proposal for CR-004's author.
- CR-006 (`O:\Org-EtohGroup\SmartGift\docs\change-requests\`) — the PII finding that blocks this.
