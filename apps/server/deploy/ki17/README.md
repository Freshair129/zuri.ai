# `ki17` build and Compose deployment

Operator notes for ADR-075 Phase 3 prerequisites P-3 to P-6. The design is
[`docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`](../../../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md);
where this file and that one disagree, the design wins.

> **Nothing here has been deployed.** No credential has been generated, no service
> started and no `docker compose` command run. The deployment is a separate operator
> step the owner triggers, and only after every item in the pre-deploy gate (§9)
> passes.
>
> **Historical G-3 record** (2026-09-16): the Phase 2 acceptance passed 35/35 inside a
> throwaway `ki17-acceptance` image built from the pinned commits — Linux, MSP/GKS/
> worker on Node 24.18.0, the P-2 Linux addon, the pinned venv, crash and replay cases
> included. The result is recorded in §9.1 of the design. The images built for it were
> test images: nothing was tagged for deployment and nothing was pushed.

## Recovery after deleted runtime roots

The 2026-09-20 recovery check found the old isolated native directories deleted
and the KI17 environment values unset. The model cache exists, but the native
launcher lacked configured source roots. The candidate check covered four
GenesisBlock directory candidates and the surviving MSP/GKS sibling checkouts.
Compose context overrides may point elsewhere, and this does not establish a
production outage.

The primary recovery route is the immutable Linux acceptance image selected for this
recovery. GitHub currently returns 422 for the pinned GenesisBlock
commit, so preserve the image digest and the output of:

~~~powershell
docker run --rm --network none --entrypoint cat sha256:6314674e54b4e2873f85be52aeb4ce69de4dcd9d26524036dfd0a49c19dfd7d0 /opt/ki17/pins/resolved.json
~~~

The verified recovery receipt is run `59a0a93d862e442895296872f4b9ca58`:
`PASS`, container exit `0`, Linux x86_64, fixed zuri.ai snapshot `3b92cd0f`,
KI17 Node `24.18.0`, Python `3.12.14`, and model revision
`614241f622f53c4eeff9890bdc4f31cfecc418b3`. It records the image, source archive,
pin and model hashes. This recovery is Linux artifact-attested; it does not claim
native Windows acceptance or production activation.

The verified recovery helper for this image is:

~~~powershell
& 'C:\Users\pc\.codex\runtimes\ki17-runtime\run-ki17-acceptance.ps1'
~~~

It runs with `--network none`, does not invoke `docker compose`, extracts and mounts the
fixed `3b92cd0f` source and complete test overlay, generates Prisma inside the
disposable Linux container, and invokes `node scripts/run-genesisrag17-acceptance.mjs`.
Each run writes a `runs/<runId>/` extraction plus run-scoped receipt, log, proof
and report directories under the runtime artifact directory.

If the image must be rebuilt from local or attested contexts, run the existing pin
gate first; it verifies commits and required entrypoints without duplicating it in
this runbook from the repository root:

~~~powershell
node .\apps\server\deploy\ki17\verify-ki17-pins.mjs --manifest .\apps\server\deploy\ki17\pins.json --context msp=<msp-context> --context gks=<gks-context> --context genesisblock=<genesisblock-context> --out <pin-receipt.json>
~~~

The final isolated container acceptance passed `40/40` tests with `0` failed,
pending or todo, across `2` test files (`5` Vitest suites); the four TASK-ZAI-094
assertions and the `2,500 ms` spawn budget hold are in the same receipt. The
grounding report records `tickElapsedMs=504` and
`groundingHopElapsedMs=[290,300,292,300]`. The runtime receipt is
`C:\Users\pc\.codex\runtimes\ki17-runtime\runs\ki17-59a0a93d862e442895296872f4b9ca58\receipt.json`,
and the tracked report is `.brain/reports/task-zai-094-line-grounding.json`.
The concise dated provenance summary is `.brain/reports/2026-09-20-ki17-runtime-recovery.json`.
The historical Linux G-3 result remains 35/35 and stays separate from this
current isolated acceptance. TASK-ZAI-095 remains the separate planned production
activation.

## What is in this directory

| File | What it is |
|---|---|
| `pins.json` | The four commits this cycle targets, the Node/Python/model versions and the worker port |
| `verify-ki17-pins.mjs` | The pin gate. Runs inside the build; refuses a context whose HEAD is not the pinned commit |
| `build-smartgift-benchmark.mjs` | P-6. Derives the one benchmark fixture a long-running worker can boot with, from the SmartGift acceptance corpus. Read its header before changing it |
| `build-smartgift-real-corpus.mjs` | Derives a benchmark corpus (the input of `build-smartgift-benchmark.mjs`) from **real** SmartGift catalog files instead of the Phase 2 test corpus. Every gold text comes from the production path (`splitSmartGiftCatalogRecords` → `renderStructuredCatalogDocument`), so a real upload can pass the retrieval dimension; queries are natural phrasings, never the chunk text itself. Regenerate it whenever the catalog changes, or Stage 16 refuses the changed records with `BENCHMARK_NO_APPLICABLE_QUERIES` |

The `ki17-acceptance` build target (gate G-3) is described under
[Running the acceptance inside the images](#running-the-acceptance-inside-the-images-gate-g-3).

## The build stages

They live in `apps/server/Dockerfile` rather than a separate file here, for one
reason: the web image's final stage has to `COPY --from` the stage that holds
`/opt/ki17`, and a stage in another Dockerfile can only be reached through a
separately built and tagged image. One file, one stage graph, no intermediate tag
to keep in sync.

`runner` is unchanged and is still what `docker compose build web` builds. Every
`ki17` stage is opt-in: BuildKit prunes the stages a `--target` does not reach, so
a normal web build neither needs nor loads the three source contexts.

`runner` is no longer the last stage in the file, so **always pass `--target`** — a
bare `docker build .` would now build `genesis-worker`. Nothing in this repository
does a bare build: `docker-compose.yml` and `.github/workflows/docker-image.yml`
both name `target: runner`.

### Supplying the three contexts

The MSP, GKS and GenesisBlock sources arrive as BuildKit additional build contexts
named `msp`, `gks` and `genesisblock`, each of which overrides an empty `scratch`
stage of the same name. The pin gate resolves each context's commit from:

1. **`.git`** — a checkout (or a worktree's `gitdir:` pointer). Verified provenance.
2. **`.ki17-pin`** — one 40-hex line. Operator-attested, for a context with no git
   metadata. Every report says which of the two it used.

A context with neither fails the build. BuildKit's git-URL form of
`--build-context` does not ship `.git`, so a URL context needs an export plus an
attestation instead:

```bash
git -C <repo> archive <sha> | tar -x -C <export-dir>
git -C <repo> rev-parse <sha> > <export-dir>/.ki17-pin
```

A plain checkout already at the pinned commit is simpler and is verified rather
than attested. Prefer it.

### Building

```bash
# The web image: runner + /opt/ki17/{node,msp,gks} + the P-5 smoke script
docker buildx build --target runner-ki17 -t zuri-ai-web-ki17:<tag> \
  --build-context msp=<Memory-and-Soul-Passport at 68e6169d> \
  --build-context gks=<Genesis-Knowledge-System at ecf1e4de> \
  apps/server

# The Tier 4 sidecar: + the GenesisBlock worker, its linux addon and the venv
docker buildx build --target genesis-worker -t zuri-ai-genesis-worker:<tag> \
  --build-context msp=<...> --build-context gks=<...> \
  --build-context genesisblock=<GenesisBlock at 5156f412da73905a23d74775a82cc14d1f6d04d0> \
  apps/server

# Gate G-3 ONLY — a test image, never deployed and never pushed. The sidecar above
# plus this app's Node 22 test runner, devDependencies, source and tests/ tree.
docker buildx build --target ki17-acceptance -t ki17-acceptance:<tag> \
  --build-context msp=<...> --build-context gks=<...> \
  --build-context genesisblock=<...> \
  --build-context ki17-tests=apps/server/tests \
  apps/server
```

Then point Compose at the results, in `apps/server/.env`:

```
ZURI_WEB_IMAGE=zuri-ai-web-ki17:<tag>
ZURI_GENESIS_WORKER_IMAGE=zuri-ai-genesis-worker:<tag>
```

`docker compose build genesis-worker` also works — that service carries the three
contexts in `additional_contexts`, defaulting to this device's sibling checkouts
and overridable with `KI17_MSP_CONTEXT`, `KI17_GKS_CONTEXT` and
`KI17_GENESISBLOCK_CONTEXT`. The `web` service's `build:` block is deliberately
untouched, so no routine web build can be broken by a missing knowledge context.

### The P-2 addon

`--target genesis-worker` used to stop at:

```
KI17_GENESISBLOCK_LINUX_ADDON_MISSING: .../npm/linux-x64-gnu/index.linux-x64-gnu.node
```

That file is prerequisite **P-2**. It landed as GenesisBlock PR #177. The current
release tuple in `pins.json` pins `genesisblock` to
`5156f412da73905a23d74775a82cc14d1f6d04d0` (the tuple the running images were
verified against: MSP `68e6169d`, GKS `ecf1e4de`); `5e75c4a8` and `7c9261c4` are
retained only as historical references, not as the current build context.
`--target runner-ki17` and `--target ki17` do not use its files, but the
`ki17-pins` stage they build on verifies every context it is given, so a build of
either still needs a `genesisblock` context at the pinned commit.

### Building web through compose

The base `docker-compose.yml` builds web with `target: ${ZURI_WEB_BUILD_TARGET:-runner}`,
so a routine web build needs no knowledge context. A host that runs GenesisRAG17
adds the opt-in overlay, which selects `runner-ki17` and supplies the three pinned
contexts with the same `KI17_*_CONTEXT` variables as the genesis-worker build:

```text
COMPOSE_FILE=docker-compose.yml;docker-compose.line-server.yml;docker-compose.ki17-web.yml
```

Without it the web image has no `/opt/ki17`: web cannot spawn the MSP/GKS stdio
servers, every Stage 9 batch stays `PENDING`, and the healthcheck still passes.
After a build, `docker run --rm --entrypoint ls <web-image> /opt/ki17` must list
`gks msp node pins`.

### Running the acceptance inside the images (gate G-3)

```bash
docker run --rm \
  -v <huggingface-snapshot-dir>:/model:ro \
  ki17-acceptance:<tag>
```

The snapshot directory is the pinned `runtime.modelRevision` of
`intfloat/multilingual-e5-small`; the worker re-verifies its five SHA-256 values at
every start, so a wrong revision fails rather than degrades. That is the same check
G-7 makes, but G-7 is about the `ki17-model` volume the deploy populates — a mounted
host cache passing it does not discharge G-7. Everything else the
suite needs is already baked and already an environment variable in the image:
`KI17_MSP_ROOT`, `KI17_GKS_ROOT`, `KI17_GENESIS_ROOT`, `KI17_MODEL_DIR`,
`GENESISRAG17_PYTHON` and `KI17_NODE`.

`KI17_NODE` is the one that is new. The image holds two Node runtimes on purpose —
Node 22 for vitest and the zuri-ai Tier 1 code, the pinned 24.18.x for MSP, GKS and
the worker — and `tests/acceptance/harness.js` reads `KI17_NODE` to decide which one
to spawn the children with. Unset (every native run) it is `process.execPath` and
nothing changes; set to a path that does not exist it throws rather than falling
back, because a run that quietly used the wrong Node would report a G-3 pass for a
runtime the deployment does not ship.

Never `docker compose` for this: the Compose project name is pinned to `zuri-ai`
and would target the live stack. `docker run` with a throwaway tag is the whole
interface.

### Which commit is this image?

The pin gate writes its receipt into both images:

```bash
docker run --rm --entrypoint cat zuri-ai-genesis-worker:<tag> /opt/ki17/pins/resolved.json
```

That answers §10 step 7's "the four commits" without archaeology.

## Compose

`genesis-worker` sits behind the `knowledge` profile, so no `docker compose up`
that does not name the profile can start it. It runs in web's network namespace
(`network_mode: "service:web"`), publishes nothing, and reads `.env.knowledge` as
its only env file.

Three named volumes, never Windows bind mounts (C8): `ki17-state` (both
containers), `ki17-genesis-store` (worker only) and `ki17-model` (worker only,
read-only).

> **`docker compose down -v` destroys the published generations.** It must never be
> part of this procedure. A reset moves the volumes aside on the owner's
> instruction; it never deletes them.

The Compose project name is pinned to `zuri-ai`, so any `docker compose` command
targets the **live** stack whichever directory it runs from (risk R-7). The
operator runs only from the primary checkout at merged `main`, after the G-8
announcement is acknowledged.

## Configuration

`apps/server/.env.knowledge` — gitignored, generated at deploy time, never
committed or pasted into a report. `.env.knowledge.example` beside it lists every
name from §7 in fill-in order.

**Read section 1 of that file before setting `ZURI_MSP_COMMAND.`** Risk R-5:
setting it turns MSP on for every caller, including the LINE thread-memory
scanner, which is gated only by `ZURI_MSP_THREAD_SERVICE_KEY` and has no enable
flag of its own. Thread memory is outside ADR-075's approval.

## Verifying the relay after a deploy

```bash
docker compose exec web node scripts/ki17-smoke.mjs
```

Two read-only checks, outcome codes only, no payloads and no credentials. Exit 0
means both relay hops answered. Run it at §10 step 4 and again after **every** web
recreate — recreating web can leave the worker listening in a dead namespace (R-2).
It is not wired into CI or Compose; it is an operator tool.

It prints one harmless `MODULE_TYPELESS_PACKAGE_JSON` warning, because it imports
the real MSP transport (a `.js` ESM file) rather than a copy of it — a copy would
only prove that the copy works. Add
`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to silence it.
