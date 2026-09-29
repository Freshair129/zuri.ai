---
version: "0.1.1b"
created_at: "2026-09-29T12:40:00+07:00,MC0"
last_update: "2026-09-29T13:05:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Watchdog-driven Docker Desktop crash loop, removal of the zuri-ai images, containers and volumes, and the rebuild on the single production host"
---

# RCA - Watchdog crash loop and loss of the ki17 volumes

## Complexity and risk

- **Complexity:** C-2 - host operations plus a rebuild, no product code change
- **Risk:** CRITICAL - two Docker volumes holding published knowledge and conversation memory were
  lost with no backup. The outage itself affected only the platform's internal test OA

## Symptom

From 2026-09-29 01:15 +07:00, web, the LINE worker, the genesis-worker, the conversation runtime and
the ngrok tunnel were offline. The Docker engine answered again at about 06:18. By 06:25 none of the
five `zuri-ai` containers existed, and later that morning the `zuri-ai` images and all three
`zuri-ai` volumes (`ki17-state`, `ki17-genesis-store`, `ki17-model`) were also found missing. The
local Supabase stack, which runs on the **same** Docker engine, kept its containers, images and
volumes (all created 2026-09-02). The main database (Supabase cloud) was not affected.

## Timeline (+07:00)

| Time | Event |
|---|---|
| 01:15 | Docker Desktop stopped (the original cause is not known). The host watchdog, installed the day before after [the 09-28 outage](2026-09-28-docker-desktop-outage-and-hidden-image-store.md), found the engine down and started Docker Desktop |
| 01:15 - 06:15 | The watchdog started or restarted Docker Desktop **37 times**. Every start first rewrote Docker Desktop's settings file, and some restarts force-stopped a Docker Desktop that was still starting |
| about 06:18 | The engine answered again |
| 06:25 | First watchdog health check with the engine up: none of the five production containers existed (see Evidence) |
| 06:25 - 12:15 | The watchdog reported web health 0 every 5 minutes |
| about 12:15 | The watchdog scheduled task was disabled and the script was repaired |
| 12:20 - 12:30 | Images rebuilt from `main` a34ceaf7, the model volume restored and hash-checked, the production benchmark fixture reinstalled, and all five services started. Web health 200 locally and through the tunnel; `ki17-smoke` PASS on both hops |

## Evidence

- **BOM parse crash.** Docker Desktop's backend log records 27 `backend crashed ... initializing
  settings loader ... loading settings from providers` entries from 2026-09-28T18:15Z (01:15 +07)
  onward. Its error dialog offered only "Quit" and "Reset to factory defaults". The watchdog log
  records a settings rewrite before each of its 37 starts. Windows PowerShell 5.1
  `Set-Content -Encoding utf8` writes a byte-order mark. The settings file now has no BOM and
  `UseContainerdSnapshotter` is `true`.
- **Containers gone by 06:25.** The pre-repair watchdog ran `docker inspect` on each production
  container once health failed twice, and logged `docker start` for any that existed but were
  stopped. From 06:25 it logged no `docker start` at all, so `docker inspect` found none of the five.
- **Not a hidden image store.** On 09-28 the same "no images" symptom was the image store setting,
  with no data lost. Here the setting is on (`UseContainerdSnapshotter: true`, containerd
  snapshotter driver), the Supabase images are visible in the same store, and named volumes do not
  depend on the image store: `docker volume ls` lists the three Supabase volumes and, before the
  rebuild, no `zuri-ai` volume. The rebuilt volumes carry 2026-09-29 creation times.
- **Not a factory reset.** A reset removes every container and volume. The Supabase ones survived.
- `docker events` does not keep history across engine restarts, so it cannot show what removed the
  `zuri-ai` objects.

## Root cause

1. **The watchdog wrote a file Docker owns, in an encoding Docker cannot read.** To protect against
   the 09-28 "hidden image store" failure, the watchdog set `UseContainerdSnapshotter` in Docker
   Desktop's settings file before every start, with a BOM (Evidence). While a rewrite with a BOM was
   in place, the backend crashed at startup, and the next check started it again. The start at about
   06:18 succeeded, which means a BOM-free settings file was in place by then. What rewrote it is
   **unverified** (possibly Docker Desktop itself, or a person using the error dialog).
2. **The watchdog had no back-off and could force-stop a starting engine.** It restarted Docker
   Desktop without a limit, and after three unresponsive checks it stopped the process even when it
   was still starting. One failure became a five-hour loop.
3. **The `zuri-ai` objects were removed selectively.** Only the `zuri-ai` compose project's
   containers, images and volumes are gone; objects of other projects on the same engine survived.
   That pattern fits a project-scoped removal (for example a compose `down` with volumes and images,
   or a manual cleanup), not a Docker reset. **Who or what did it, and exactly when, is
   unverified.** The containers were gone by 06:25.
4. **No backup of the ki17 volumes existed.** `ki17-state` (MSP and GKS SQLite stores) and
   `ki17-genesis-store` (published generations) lived only on Docker's WSL2 data disk. The
   [deployment plan](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md) (§6) warns never to run
   `down -v`, but nothing enforced it and no copy existed elsewhere.

## Impact

- About 11 hours without web, the ngrok tunnel, LINE webhook intake, the LINE worker, the
  genesis-worker and the conversation runtime. The Zuri OA is the platform's internal test OA (4 to
  5 testers); no customer OA was connected. Whether the OA was producing replies before the outage
  is tracked separately in
  [the LINE OA RCA](2026-09-28-zuri-line-oa-silent-since-0914.md), which is still open.
- **Lost:** MSP conversation memory and journal, GKS decisions and receipts, and the 22 published
  SmartGift knowledge generations. The main database still records those 22 ingestions as
  `PUBLISHED`, so it disagrees with the empty genesis store until they are published again.
- **Recovered:** the embedding model (restored from a local cache, all five files match the pinned
  SHA-256), and the production benchmark fixture (an untracked copy on the host was byte-identical
  to the deployed file, sha256 `d2d40084…`, as recorded in
  [the B2 rehearsal](../reports/2026-09-24-genesisrag17-b2-fixture-rehearsal.md)).

## Why the issue escaped detection

- The watchdog was written and enabled in one session with no test against Docker Desktop's
  settings parser, and PowerShell 5.1's BOM behavior was not considered.
- The watchdog alerted only through desktop notifications on the same host, so nobody saw the loop.
- It had no alert for a container that is missing rather than stopped.

## Fix applied

The watchdog script lives on the production host, outside this repository. It was changed as below.
Only a PowerShell parse check has been run; the new behavior is **untested** until the task is
re-enabled.

- It **only reads** Docker's settings file and alerts when the image store setting is off. It never
  writes it.
- It makes **at most two** automatic starts per outage, then alerts every hour and leaves recovery to
  a person. It never force-stops Docker Desktop.
- It alerts when a production container is **missing**, not only stopped.
- The scheduled task stays **disabled** until the owner re-enables it.

## Proposed prevention

1. **Rule (proposed):** host automation must never write a file owned by another program. It reads
   and alerts, and any automatic restart has a fixed attempt limit per outage.
2. Back up `ki17-state` and `ki17-genesis-store` off the Docker disk on a schedule, and after every
   publication, with a documented restore that has been rehearsed once.
3. Keep the production benchmark fixture's deployed copy somewhere durable.
   [§10.1](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md) already asks for a copy with every
   change; this time it survived only because an untracked file happened to exist.
4. Send watchdog alerts to a channel someone reads off the host, not only desktop notifications.
5. Add a reconciliation check that flags ingestions recorded as `PUBLISHED` when the genesis store
   holds no matching generation.
6. Find out what removed the `zuri-ai` objects: check the other automations and agent sessions
   active on the host that night, and turn on persistent Docker event logging.

## Open follow-ups

- Re-publish the 22 SmartGift records. This is an owner decision, and the main database status
  must be reconciled first so the pipeline will run them again.
- Decide whether to re-enable the repaired watchdog.
