---
version: "0.1.0b"
created_at: "2026-09-29T12:40:00+07:00,MC0"
last_update: "2026-09-29T12:40:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Watchdog-driven Docker Desktop crash loop, loss of every image and Docker volume, and the rebuild on the single production host"
---

# RCA - Watchdog crash loop and loss of the ki17 volumes

## Complexity and risk

- **Complexity:** C-2 - host operations plus a rebuild, no product code change
- **Risk:** CRITICAL - production was offline for about 11 hours and two Docker volumes were lost
  with no backup

## Symptom

From 2026-09-29 01:15 +07:00, web, the LINE worker, the genesis-worker, the conversation runtime and
the ngrok tunnel were offline. When the Docker engine answered again at about 06:18, every zuri
image and container was gone, and so were the `ki17-state` and `ki17-genesis-store` volumes. Only
the separate local Supabase stack survived. The main database (Supabase cloud) was not affected.

## Timeline (+07:00)

| Time | Event |
|---|---|
| 01:15 | Docker Desktop stopped (the original cause is not known). The host watchdog, installed the day before after [the 09-28 outage](2026-09-28-docker-desktop-outage-and-hidden-image-store.md), found the engine down and started Docker Desktop |
| 01:15 - 06:15 | The watchdog started or restarted Docker Desktop **37 times**. Every start first rewrote Docker Desktop's settings file, and some restarts force-stopped a Docker Desktop that was still starting |
| about 06:18 | The engine answered again. No images, containers or zuri volumes were present |
| 06:20 - 12:15 | The watchdog reported web health 0 every 5 minutes and tried `docker start` on containers that no longer existed |
| about 12:15 | The watchdog scheduled task was disabled and the script was repaired |
| 12:20 - 12:30 | Images rebuilt from `main` a34ceaf7, the model volume restored and hash-checked, the production benchmark fixture reinstalled, and all five services started. Web health 200 locally and through the tunnel; `ki17-smoke` PASS on both hops |

## Root cause

1. **The watchdog wrote a file Docker owns, in an encoding Docker cannot read.** To protect against the
   09-28 "hidden image store" failure, the watchdog set `UseContainerdSnapshotter` in Docker
   Desktop's settings file before every start. Windows PowerShell 5.1 `Set-Content -Encoding utf8`
   writes a byte-order mark. Docker Desktop fails to parse a settings file that starts with a BOM, so
   every start the watchdog made crashed, and the next check started it again.
2. **The watchdog had no back-off and could force-stop a starting engine.** It restarted Docker
   Desktop without a limit, and after three unresponsive checks it stopped the process even when it
   was still starting. One failure became a five-hour loop.
3. **The data loss.** At some point in the loop Docker's data was reset: images, containers and all
   named volumes disappeared together. That pattern matches Docker Desktop's reset to factory
   defaults, but the logs do not show what triggered it. **Unverified.**
4. **No backup of the ki17 volumes existed.** `ki17-state` (MSP and GKS SQLite stores) and
   `ki17-genesis-store` (published generations) lived only on Docker's WSL2 data disk. The
   deployment plan warns never to run `down -v`, but nothing protected against the disk itself being
   reset.

## Impact

- About 11 hours without the LINE OA reply path. The Zuri OA is the platform's internal test OA
  (4 to 5 testers); no customer OA was connected.
- **Lost permanently:** MSP conversation memory and journal, GKS decisions and receipts, and the 22
  published SmartGift knowledge generations. The main database still records those 22 ingestions as
  `PUBLISHED`, so it disagrees with the empty genesis store until they are published again.
- **Recovered:** the embedding model (restored from a local cache, all five files match the pinned
  SHA-256), and the production benchmark fixture (an untracked copy on the host was byte-identical
  to the deployed file, sha256 `d2d40084…`, as recorded in
  [the B2 rehearsal](../reports/2026-09-24-genesisrag17-b2-fixture-rehearsal.md)).

## Why detection escaped

- The watchdog was written and enabled in one session without a test against Docker Desktop's
  actual settings parser, and PowerShell 5.1's BOM behavior was not considered.
- The watchdog alerted only through desktop notifications on the same host, so nobody saw the loop.
- The alert for "containers missing" did not exist; it only knew how to start stopped containers.

## Fix applied

- The watchdog now **only reads** Docker's settings file and alerts when the image store setting is
  off. It never writes it.
- It makes **at most two** automatic starts per outage, then alerts every hour and leaves recovery to
  a person. It never force-stops Docker Desktop.
- It alerts when a production container is **missing**, not only stopped.
- The scheduled task stays **disabled** until the owner re-enables it.

## Proposed prevention

1. **Rule (proposed):** a host automation must never write a file owned by another program; it
   reads and alerts. Any automatic restart has a fixed attempt limit per outage.
2. Back up `ki17-state` and `ki17-genesis-store` off the Docker disk on a schedule, and after every
   publication, with a documented restore that has been rehearsed once.
3. Track the production benchmark fixture's deployed copy somewhere durable (§10.1 already asks for
   a copy with every change; it survived here only by luck as an untracked file).
4. Send watchdog alerts to a channel someone reads off the host, not only desktop notifications.
5. Add a reconciliation check that flags ingestions recorded as `PUBLISHED` when the genesis store
   holds no matching generation.

## Open follow-ups

- Re-publish the 22 SmartGift records (owner decision; the main database status must be reconciled
  first so the pipeline will run them again).
- Decide whether to re-enable the repaired watchdog.
