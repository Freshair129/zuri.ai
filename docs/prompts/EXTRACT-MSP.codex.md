# Codex task — Extract MSP from GoVibe into a standalone repo `Freshair129/msp`

You are extracting the Mission State Protocol (MSP) memory runtime out of the GoVibe
monorepo into its own standalone repository. This is **packaging and dependency
cleanup, not a rewrite** — the logic, wire protocol, storage format and public
behaviour must be preserved byte-for-behaviour. The single most important success
criterion is a **compatibility gate**: GoVibe must keep working, unchanged in
behaviour, consuming the extracted MSP.

## Absolute constraints
- **`G:\govibe` is the READ-ONLY source.** Copy out of it. Do NOT edit, move, or delete
  anything inside `G:\govibe` as part of the extraction itself. (A later, separate step
  repoints GoVibe at the new package — see "Compatibility proof" — and that is the only
  time GoVibe files change, minimally and reversibly.)
- **Never read any `.env` file.** Env var *names* in code are fine; values are not.
- **Do not change the wire protocol, the SQLite schema, the tool names, or the vault
  semantics.** No behavioural change. If you find a bug, record it in `NOTES.md` — do
  not fix it during extraction (that hides regressions behind refactors).
- Preserve the GKS provider bridge's **fail-closed** behaviour exactly (see
  `G:\govibe\docs\adr\ADR-028-MSP-GKS-Provider-Bridge.md`): `msp_knowledge_promote` /
  `msp_memory_promote(target_scope=shared)` must still deny with
  `gks_provider_unconfigured` when no provider is set.

## What MSP is (source facts)
- Runtime package: `G:\govibe\packages\msp-runtime` — name `@govibe/msp-runtime`
  v0.1.0, ESM (`"type":"module"`), single runtime dependency `better-sqlite3 ^11.10.0`,
  a `bin` entry, `server.mjs` entry. Its `src/` already separates: `contracts/`, `db/`,
  `domain/`, `providers/`, `retrieval/`, `transport/`, plus `server.mjs`. Tests in
  `test/` (vitest; includes security suites).
- Transport: newline-delimited JSON-RPC 2.0 over **stdio** with an MCP-shaped handshake
  (`initialize`, protocolVersion 2024-11-05, then `notifications/initialized`, then
  `tools/call`). There is **no `tools/list`** — clients call `tools/call` directly with
  static schemas from the contract.
- Memory model: one SQLite file at `MSP_DB_PATH`; 3 vaults (`shared` |
  `workspace_private` | `global_private`); bitemporal versioned entities
  (valid_from/valid_to + recorded_at/superseded_at); epistemic states; confidence;
  decay; append-only journal; memory links.
- Wire contract: `G:\govibe\docs\api\API-009-Persistent-Memory-Contract.md` — the nine
  `msp_*` tools (workspace_register, vault_status, memory_upsert, memory_search,
  memory_history, memory_links_create/list, knowledge_promote, memory_promote), with
  request/response JSON and error/idempotency semantics. Treat API-009 as the frozen
  external contract.
- The consumer client already lives in `G:\govibe\packages\govibe-core\src`:
  `msp-stdio-transport.mjs` (`createMspStdioCaller` — spawn, NDJSON framing, handshake,
  timeout, stderr tail) and `msp-client.mjs` (`MspClient`,
  `createMspClientFromEnvironment`, `createUnavailableMspClient`,
  `inspectMspConfiguration`), both re-exported from `govibe-core/src/index.mjs`.
  `gks-client.mjs` is a deprecated shim — carry it only if GoVibe still imports it.

## Target repository layout (create `Freshair129/msp`)
```
msp/
├── apps/
│   └── msp-server/         ← server.mjs + bin + transport/ + providers/  (the runnable process)
├── packages/
│   ├── msp-core/           ← domain/  (memory entities, vault logic, decay, lineage)
│   ├── msp-contracts/      ← contracts/ + a machine copy of the API-009 tool schemas
│   ├── msp-client-js/      ← msp-stdio-transport.mjs + msp-client.mjs (the external client)
│   ├── msp-retrieval/      ← retrieval/  (search; FTS now, vector/bge-m3 behind a flag)
│   └── msp-storage/        ← db/  (better-sqlite3 access, schema, migrations runner)
├── migrations/             ← the SQLite migrations, with explicit migration ownership
├── tests/
│   ├── contract/           ← API-009 conformance (request/response for all nine tools)
│   ├── security/           ← vault isolation, per-request scoping (from the source suites)
│   └── integration/        ← boot → register → upsert → search → history → decay → replay
├── docs/                   ← copied API-009, an ARCHITECTURE.md, and NOTES.md
├── package.json            ← workspaces: ["apps/*","packages/*"]
└── README.md
```
Use a workspace monorepo (npm/pnpm workspaces). `msp-client-js` must be publishable and
usable **standalone** (it is what external agents — GoVibe, and later Zuri — import).

## Method (phased; keep it a copy+split, not a rewrite)
1. **Inventory** the source: read `msp-runtime/src/**` and the two govibe-core client
   files; map every file to its target package above. Write the mapping to
   `docs/NOTES.md` before moving code.
2. **Scaffold** the monorepo, workspaces, and each package's `package.json` with correct
   inter-package deps (`msp-server` → core/contracts/storage/retrieval/transport;
   `msp-client-js` depends on nothing but node).
3. **Copy** the source files into their packages **unchanged in logic**. Fix only import
   paths and package boundaries. Keep ESM, keep `better-sqlite3`, keep the bin.
4. **Move the tests** into `tests/{contract,security,integration}`; keep them green
   against the reorganised code. Add contract tests for any API-009 tool not already
   covered.
5. **Boot standalone**: `node apps/msp-server/bin/…` with `MSP_DB_PATH` set to a temp
   path creates+migrates the DB and serves over stdio. Prove the full loop from an
   external client (`msp-client-js`) in a fresh process.
6. **Compatibility proof (the gate):** make GoVibe consume the extracted MSP. The
   minimal, reversible change to `G:\govibe`: point `govibe-core`'s MSP import at the
   new `msp-client-js` package (workspace link or `file:` dependency) and confirm
   GoVibe's own MSP tests still pass. If you cannot run GoVibe's suite, produce the
   exact diff + commands for the owner to run, and do not claim the gate passed.

## Gate A — definition of done (do not report success until all are true)
- [ ] MSP server boots standalone from the new repo (no GoVibe on the path)
- [ ] `msp-client-js` connects from a separate external process
- [ ] memory CRUD works (upsert / search / history)
- [ ] search works (FTS with no extra infra; vector behind a flag, not required)
- [ ] vault isolation holds (security tests pass — cross-vault access denied)
- [ ] context resolve / lineage / replay work
- [ ] decay lifecycle works
- [ ] contract + security + integration tests all green
- [ ] GKS promotion still fail-closed (`gks_provider_unconfigured`) with no provider
- [ ] **GoVibe still uses the new MSP unchanged in behaviour** (compatibility proof)

## Deliverables
1. The `Freshair129/msp` repo, monorepo per the layout, on a branch (do not force-push
   to main; open it for review).
2. `docs/NOTES.md`: the file→package mapping, any bug found (recorded, not fixed), and
   anything that could not be cleanly separated.
3. `docs/MIGRATION.md`: how GoVibe (and any future consumer) switches to the extracted
   MSP — the exact dependency change and the commands to verify.
4. A short final report: Gate A checklist with pass/fail per item and the evidence
   (commands run, test output summary). If any item is unverified, say so plainly.

## Do NOT
- rewrite MSP's logic, storage schema, or wire protocol
- change tool names or API-009 semantics
- "improve" the GKS bridge (keep it fail-closed)
- read any `.env`
- modify `G:\govibe` beyond the single minimal compatibility repoint (step 6), and only
  after the standalone gate items pass
- report Gate A as passed on any item you did not actually verify
