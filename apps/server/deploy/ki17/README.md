# `ki17` build and Compose deployment

Operator notes for ADR-075 Phase 3 prerequisites P-3 to P-6. The design is
[`docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`](../../../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md);
where this file and that one disagree, the design wins.

> **Nothing here has been deployed.** No image has been built against the pinned
> commits, no container started, no credential generated. The deployment is a
> separate operator step the owner triggers, and only after every item in the
> pre-deploy gate (§9) passes — including **G-3**, which re-runs the Phase 2
> acceptance inside these images, on Linux, and has not run.

## What is in this directory

| File | What it is |
|---|---|
| `pins.json` | The four commits this cycle targets, the Node/Python/model versions and the worker port |
| `verify-ki17-pins.mjs` | The pin gate. Runs inside the build; refuses a context whose HEAD is not the pinned commit |
| `build-smartgift-benchmark.mjs` | P-6. Derives the one benchmark fixture a long-running worker can boot with, from the SmartGift acceptance corpus. Read its header before changing it |

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
  --build-context msp=<Memory-and-Soul-Passport at 49fe7de7> \
  --build-context gks=<Genesis-Knowledge-System at ecf1e4de> \
  apps/server

# The Tier 4 sidecar: + the GenesisBlock worker, its linux addon and the venv
docker buildx build --target genesis-worker -t zuri-ai-genesis-worker:<tag> \
  --build-context msp=<...> --build-context gks=<...> \
  --build-context genesisblock=<GenesisBlock at 907b0ff4> \
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

### It currently fails, on purpose

`--target genesis-worker` stops at:

```
KI17_GENESISBLOCK_LINUX_ADDON_MISSING: .../npm/linux-x64-gnu/index.linux-x64-gnu.node
```

That file is prerequisite **P-2**, built by the sibling GenesisBlock pull request
(branch `feat/genesisrag17-worker-linux-x64`) from the same pinned commit. Every
acceptance so far ran on Windows (C11). `--target runner-ki17` and `--target ki17`
do not need it and complete.

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
