---
doc_type: intake-note
status: active
version: "1.0.0"
updated_at: "2026-08-30"
---

# CR-004 — the shape this repository will accept

**Status:** Active
**Version:** 1.0.0

A companion to `CR-004-GITHUB-INTEGRATION-AND-FILES-TAB-EXPLORER.md`, written
the way `CR-003-ACCEPTED-SHAPE.md` and `README.md` record findings: **next to
the document, not inside it.** CR-004's text stays as its author wrote it. This
file says what of it this repository will take, in what shape, and what it has
instead of the parts it refuses.

The short version, and it is the same shape CR-003's answer took:
**your binding is right, your columns are in the wrong place, and the entity you
need already exists.** One requirement has been declared out of CR-004 —
**FR-130** — and it adds no model, no column and no migration. It is also
declared **blocked**, on something CR-006 found, and that part is not a
formality: see §4.

## 1. What CR-004 got right

Recorded first, because a reply that lists only refusals reads as a rejection
and this is not one. Three of these the review in `README.md` did not credit.

1. **Business is the right scope.** CR-004 binds a repository at the Business
   level. That is exactly what this repository decided in **FR-073**, and it was
   forced rather than chosen: the viewer contract carries only Business-keyed
   grants, so no principal can hold authority above Business (SDD-037) and a
   Tenant-scoped repository would be ungovernable. You picked the one scope that
   works. The review's counter-suggestion — put it on `IntegrationConnection` —
   would have been worse than your proposal on this axis.
2. **A default branch belongs on the binding.** `Repository.defaultBranch` has
   existed since FR-008; your `githubBranch @default("main")` is the same field.
3. **Read-only is the correct invariant.** §3.1 — "edits must be performed via
   Git pull requests or authorized agent commits" — matches this repository's
   grain exactly and is not contested anywhere.
4. **The sync facts are the right facts to want** — a head SHA, a last-sync time
   and a sync status are what an operator asks for. They turn out not to need
   storing under the design in §2, and where they *would* live if a cache is
   added later is §2.1. That is a disagreement about mechanism, not about the
   facts being useful.
5. **Purpose badges are a real idea with a real home.** Your
   `[Raw Data]` / `[Prepared Catalog]` / `[Review Report]` / `[Vault DB]` labels
   are a path→meaning mapping, and `ProjectRepository.pathScope` is the field
   that carries a path declaration per binding today.

## 2. What is refused, and what stands in its place

### The five columns on `Business` — refused; `Repository` already exists

This is the whole of §2.A, and the correction is not the one `README.md` gave.

`README.md` refused your columns and pointed at `IntegrationConnection`. **That
was half wrong**, and recording it here matters because acting on it would have
cost you real work: you would have built a second repository record beside one
that has been in this schema since FR-008.

```prisma
model Repository {
  id             String   @id @default(uuid())
  code           String   @unique          // human code (BR-002)
  businessId     String?                   // FR-073 — owned by one Business
  provider       String                    // 'github' is already the UI default
  externalRepoId String?                   // GitHub's numeric id — mapped, never keyed
  ownerName      String?
  repoName       String?
  fullName       String?
  url            String?                   // ← your githubRepoUrl
  defaultBranch  String?                   // ← your githubBranch
  status         String   @default("ACTIVE")
}
```

It is live, not vestigial: `/api/repositories`, `/api/repositories/[id]`,
`/api/repositories/link` and `/api/repositories/link/[id]` are all served and
viewer-scoped (`ownsBusiness` to write, `seesBusiness` to read, FR-073), and
`/repositories` renders it with a provider dropdown **whose default option is
already `github`**. That page's own subtitle has been stating your gap since it
shipped:

> Local metadata only — provider, name, URL, default branch. No GitHub API
> access in MVP.

So the mapping is:

| Your field on `Business` | Accepted shape |
|---|---|
| `githubRepoUrl` | `Repository.url`, beside `ownerName` / `repoName` / `fullName` |
| `githubBranch` | `Repository.defaultBranch`; `ProjectRepository.branch` overrides per project link |
| `lastCommitSha` | **not stored** — §2.1 below |
| `lastGithubSyncAt` | **not stored** — §2.1 below |
| `githubSyncStatus` | **not stored** — §2.1 below |
| (unstated) the GitHub repo id | `Repository.externalRepoId` + `ExternalEntityRef` |
| (unstated) a private-repo token | `IntegrationCredential.secretRef` — the reference, never the material |

### 2.1 Your three sync fields are not moved — they are dropped

This is the one place the accepted shape is *smaller* than a relocation, and it
is worth understanding rather than working around.

`lastCommitSha`, `lastGithubSyncAt` and `githubSyncStatus` all describe **a
mirror kept in step with an origin**. That is the right design if zuri-ai copies
your repository. It does not: the projection reads through (§2 above, and §4 is
why), so the tree comes from a live fetch and the commit a reader is looking at
is already in that response. Persisting it would be a second answer to a
question the response carries — and a stale one the first time a fetch fails.

If a cache is added later, those facts do have homes —
`SyncCursor.cursorValue`, `SyncCursor.lastSuccessAt`, `IngestionRun.status` —
and one keying question has to be decided at that point rather than assumed:
`SyncCursor` is unique on `(connectionId, resourceType)`, so a single connection
covering several repositories has **no per-repository cursor** without either
compounding an id into `resourceType` or narrowing a connection to one
repository. `IntegrationConnection.externalAccountId` names an *account*, which
is exactly why `Repository` is its own model. Nothing has chosen for you here.

**Why `Business` is refused, in two parts.** The first is BR-002, and it is not
tidiness: that rule names *"GitHub id"* in its own example list, so a foreign URL
and commit SHA on a core scope row is the exact case it was written for. The
second the review did not mention — columns on `Business` cap a Business at
**one** repository, where `Repository` has always permitted many and
`ProjectRepository` already fans them across projects. Your own §2.B assumes
several directory trees; the shape you proposed cannot hold two.

### `/api/webhooks/github` — refused as an endpoint, accepted as an adapter

FR-081 already names four acquisition source types — `PULL`, `WEBHOOK`, `FILE`,
`MANUAL` — and requires every channel to converge on one normalized ingestion
envelope, adding "an adapter rather than a second raw-write path". A bespoke
webhook route is that second path. This is the same finding CR-005 drew for its
LINE connector, and it is the rule this repository is least willing to bend:
one envelope, one raw writer, converters at the edges.

It also lands in the wrong lane. `src/app/api/**` resolves to the
project-manager charter; an ingestion adapter belongs under
`src/app/api/platform/integrations/**`, which the integration charter owns.

**Your two omissions are resolved, not merely flagged.** `README.md` noted the
webhook "carries no tenant in its path and no authentication story". Here is
what this repository will accept for both:

- **Tenant comes from the binding, never from the payload.** The delivery's
  `installation.id` selects an `IntegrationConnection` on
  `(providerId = github, externalAccountId)` — the key
  `@@unique([tenantId, providerId, externalAccountId])` was built for exactly
  "this tenant binds this external account at this provider". **Zero or multiple
  candidates fail closed**, which is FR-079's existing rule for connection
  selection, not a new invention. The connection carries the trusted `tenantId`
  and `businessId`; `repository.id` then resolves to a `Repository` through
  `ExternalEntityRef`. `repository.full_name` from the payload is never a key.
- **Authentication is `X-Hub-Signature-256`, verified before anything else.**
  HMAC-SHA256 over the **raw** body under the connection's webhook secret,
  resolved from `IntegrationCredential.secretRef` through the
  `SecretManagerPort`, constant-time compared. Ordering is part of the
  requirement: routing reads `installation.id` and nothing else — a non-secret
  selector the signature subsequently proves — so nothing is written and nothing
  is interpreted until verification succeeds.

### Persisting file content — refused, and this one is load-bearing

FR-081(c) says raw payloads are persisted **verbatim** as replayable evidence.
Read literally that applies to your file tree, and it is the one place in this
proposal where following the rule is the defect. So the accepted shape splits:

- **Push metadata persists.** Head SHA, changed paths, actor, timestamps become
  a `RawExternalRecord` under the one envelope with `sourceType: 'WEBHOOK'`, and
  `SyncCursor.cursorValue` advances. This is ordinary FR-081 work.
- **File bytes never persist.** Tree and blob reads are read-through; the
  previewer renders and stores nothing.

The reason is §4. This carve-out is written into SDD-076 rather than left
implicit, precisely because a reader who finds FR-081(c) and not SDD-076 will
persist the blobs and be able to cite a requirement for it.

## 3. Your §2.B — not refused, but not one requirement

The four-part explorer — recursive tree, purpose badges, multi-format previewer,
file metadata — is a feature programme, the same disposition CR-003's dashboard
got. FR-130 declares the binding and the read contract such an explorer would
call; it is not the explorer.

Two things to know before you design it:

- **A Files tab already exists.** FR-045's Business File Manager at `/files`,
  over `FileAsset`/`FileLink`/`LocalWorkspaceMount`, with
  `/projects/[projectId]/files` beside it. Where a repository projection sits
  relative to that is an open product question, not a blank field.
- **`/platform/**` is not a workspace surface.** Your proposed
  `/platform/workspaces/[id]/files` mixes two shells: `/platform/` is the
  Platform admin sub-domain — its five children are `integrations`,
  `customer-import-reviews`, `users`, `sot-pipeline` and `product-readiness` —
  while workspaces live at `/workspaces/[workspaceId]`.

Also worth knowing: `/platform/integrations` used to render a "GitHub
Repositories" tile hardcoded `status: 'CONNECTED'` while nothing connects.
**Corrected 2026-08-30** — every tile now derives its state from the connection
read model, and the GitHub one reads `NOT_CONNECTED · CONNECTOR_NOT_IMPLEMENTED`.
That was the one part of FR-130 not behind its blocker; the rest still is.

## 4. Why FR-130 is declared **blocked**, and what would unblock it

This is the part that is not negotiable and not a formality.

**CR-006 changed this proposal's premise.** The repository §2.A names held three
spreadsheets of real customer data — a contact list for a named legal entity, a
quotation report, and per-customer purchase history — tracked in git on a
**public** remote, verified four ways on 2026-08-30. It is private now and the
files are untracked, but the history retains them, and throughout `git status`
reported nothing wrong.

A Files tab renders whatever the bound tree contains. So the question is not
"has that repository been cleaned" but **what happens when a bound repository
holds data this system's own PDPA controls would never admit through the front
door.**

Two controls in the accepted shape answer part of it:

1. **Nothing is stored** (§2 above), so there is no unerasable copy. This
   matters concretely: FR-022 erases through `Person`/`Customer` and SEC-005
   consent is attested on the FR-023 `Customer` row per Business (SDD-053). Rows
   inside a spreadsheet inside a blob have neither — persisting them would create
   personal data that is unconsented and, by construction, unerasable.
2. **Deny-by-default path scope.** The projection reads only paths a binding
   declares, in the shape SEC-009 already applies to LINE knowledge access.
   `ProjectRepository.pathScope` is the field, already threaded end-to-end
   (input schema, service, read model, a UI pill, plan and xlsx import) —
   though nothing treats it as a boundary today, so FR-130 makes an existing
   descriptive field load-bearing. Your CR-006 §5.2 exclusion of `vaults/` falls
   out of the same mechanism, and this is also where your purpose badges live.

**Neither answers the third thing, and that is the blocker:**

> Nothing in this repository can determine whether a declared path contains
> personal data, and there is nowhere to record an assertion that it does not.

Whoever binds a repository asserts something about its contents that zuri-ai
cannot verify. There is no attestation shape for "this path holds no personal
data", no policy for who may make one, and no audit event to carry it. Without
that, a projection is a disclosure surface with no consent record: every viewer
holding `seesBusiness` on the bound Business reads whatever the tree holds,
under zuri-ai's access control rather than GitHub's.

**Cleaning the SmartGift repository does not unblock this.** It removes today's
instance; the next bound repository has the identical unverifiable property. The
blocker is structural, which is why FR-130 is declared blocked in the sense
FR-121 is — on a named thing, not on effort.

**What would unblock it** is a product and data-protection decision, not code:
who may attest that a declared path scope is free of personal data, what is
recorded when they do, and what the system does when that attestation turns out
to be wrong. That decision is not ours to make unilaterally, and FR-130 says so
in its status cell rather than quietly waiting.

One honest limit on control 2, since you will hit it: changed *paths* are
metadata, but a path can itself be personal data — CR-006 declines to reproduce
the filenames it found for exactly that reason. The metadata lane is bounded by
the same path scope and is not clean merely by being metadata.

## 5. Smaller things, none blocking

- **`DATA_LANES` has no honest value for a source repository.** The lanes are
  business-semantic — `ACCOUNTING`, `SALES`, `PRODUCTION_SUPPLY`, `MARKETING`,
  `CUSTOMER`, `BUSINESS`, `MARKET_INTELLIGENCE`. Calling a repository push
  `BUSINESS` would make the acquisition provenance lie about its semantic lane,
  which is precisely the argument ADR-038 made when it added
  `MARKET_INTELLIGENCE` instead of reusing one. Adding a lane costs no migration
  (`lane` is a plain `String`), but it is that decision made once.
- **Tree truncation and size**, which you already flagged in CR-006 §3: the
  GitHub trees API truncates large trees, and `data-pipeline/` is 112 MB. A
  projection pages; it does not fetch recursively and hope.
- **Registering the provider needs no migration.** `registerProvider` is
  idempotent on its code, so a `github` `IntegrationProvider` row is a seed, not
  a schema change.

## 6. If you want to take this further

The route is `CLAUDE.md` → *Adding a feature*, and `README.md` in this folder
states it for CRs specifically. Nothing about arriving as a CR shortens it.

But note what FR-130 cost, and how much of your proposal survived: **one FR, one
SDD, no schema, no column, no migration** — because the entity you needed was
already here, Business-scoped, viewer-guarded, and rendered by a page whose
subtitle names the exact gap you set out to close. That is the usual outcome of
checking a proposal against the tree before designing against it, and it is why
these notes are written where the tree can see them.

The one thing that did not shrink is §4, and it is the thing worth your
attention first: the data-protection question is upstream of every line of code
in this proposal.
