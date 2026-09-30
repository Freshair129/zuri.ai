---
version: "0.2.1b"
created_at: "2026-09-29T12:40:00+07:00,MC0"
last_update: "2026-09-29T13:55:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Watchdog-driven Docker Desktop crash loop, removal of the zuri-ai images, containers and volumes and of the local knowledge object store, the takeover of its port, the rebuild and the re-publish of the SmartGift records on the single production host"
---

# RCA - Watchdog crash loop, loss of the ki17 volumes and the knowledge object store

## Complexity and risk

- **Complexity:** C-2 - host operations plus a rebuild, no product code change
- **Risk:** CRITICAL - three Docker data volumes were lost with no backup: the two ki17 volumes
  (published knowledge and conversation memory) and the knowledge object store (raw catalog
  files). The outage itself affected only the platform's internal test OA

## Symptom

From 2026-09-29 01:15 +07:00, web, the LINE worker, the genesis-worker, the conversation runtime and
the ngrok tunnel were offline. The Docker engine answered again at about 06:18. Later that morning
the five `zuri-ai` containers, the `zuri-ai` images and all three `zuri-ai` volumes
(`ki17-state`, `ki17-genesis-store`, `ki17-model`) were found missing. At about 12:50 the local
knowledge object store was also found missing: the container `zuri-minio-community-local`, its
locally built image and its data volume `zuri-minio-community-local-data`, none of which are part
of the `zuri-ai` compose project.
The local Supabase stack, which runs on the **same** Docker engine, kept its containers, images and
volumes (all created 2026-09-02). The main database (Supabase cloud) was not affected.

## Timeline (+07:00)

| Time | Event |
|---|---|
| 01:15 | Docker Desktop stopped (the original cause is not known). The host watchdog, installed the day before after [the 09-28 outage](2026-09-28-docker-desktop-outage-and-hidden-image-store.md), found the engine down and started Docker Desktop |
| 01:15 - 06:15 | The watchdog started or restarted Docker Desktop **37 times**. Every start first rewrote Docker Desktop's settings file, and some restarts force-stopped a Docker Desktop that was still starting |
| about 06:18 | The engine answered again |
| 06:25 - 12:15 | The watchdog reported web health 0 every 5 minutes and logged no `docker start` (see Evidence) |
| late morning | MC0 found the `zuri-ai` containers, images and volumes missing |
| about 12:15 | The watchdog scheduled task was disabled and the script was repaired |
| 12:20 - 12:30 | Images rebuilt from `main` a34ceaf7, the model volume restored and hash-checked, the production benchmark fixture reinstalled, and all five services started. Web health 200 locally and through the tunnel; `ki17-smoke` PASS on both hops |
| about 12:39 | The owner approved re-enabling the repaired watchdog; it was enabled and its first run logged web health back to 200 |
| 12:43 - 12:45 | ki17 backup set up (every 6 hours to a separate drive) and a restore of the two ki17 volumes rehearsed into scratch volumes |
| about 12:50 | The first catalog upload failed with "Object storage request was rejected". Port 19000, which the knowledge store used, was now served by an unrelated development stack started at 09:06 on the same host |
| 12:54 - 12:55 | Knowledge store rebuilt from the same MinIO source commit on port 19100, bucket (versioned) and app user provisioned, web recreated to point at it |
| 12:55 - 13:19 | The 22 SmartGift records re-admitted as byte-different copies of the same catalog files (uploads 12:55 and 12:58): 22 of 22 `PUBLISHED`, 17 of 17 stages each, 22 publication receipts (first 12:56, last 13:19). The object store was added to the backup at 12:57 and its restore rehearsed at about 12:58 |
| 13:20 - 13:22 | The 22 old sources, which pointed at lost snapshots, were withdrawn: `revokedAt` set and their ingestions marked `WITHDRAWN`; history kept |
| 13:24 | Post-publish backup taken |

## Evidence

- **BOM parse crash.** Docker Desktop's backend log records 23 `backend crashed ... loading settings
  from providers` entries from 2026-09-28T18:15Z (01:15 +07) onward, each ending in
  `invalid character 'ï' looking for beginning of value`. `ï` is how the first byte of a UTF-8 BOM
  reads when decoded as Latin-1. There are fewer crash entries than the watchdog's 37 starts,
  most likely because some starts were force-stopped by the watchdog and some ended in an unresponsive engine
  rather than a logged crash. Its error dialog offered only "Quit" and "Reset to factory defaults". The watchdog log
  records a settings rewrite before each of its 37 starts. Windows PowerShell 5.1
  `Set-Content -Encoding utf8` writes a byte-order mark. The settings file now has no BOM and
  `UseContainerdSnapshotter` is `true`.
- **No stopped container after 06:18.** Once health failed twice, the pre-repair watchdog ran
  `docker inspect` on each production container and logged `docker start` for any that existed but
  were stopped. From 06:25 it logged no `docker start`. That rules out stopped containers, not
  running ones, so it does not prove the containers were already gone. Given six hours of health 0
  with `unless-stopped` containers, they most likely were. **Not verified.**
- **Not a hidden image store.** On 09-28 the same "no images" symptom was the image store setting,
  with no data lost. Here the setting is on (`UseContainerdSnapshotter: true`, containerd
  snapshotter driver), the Supabase images are visible in the same store, and named volumes do not
  depend on the image store: `docker volume ls` lists the three Supabase volumes and, before the
  rebuild, no `zuri-ai` volume. The rebuilt volumes carry 2026-09-29 creation times.
- **Not a factory reset.** A reset removes every container and volume. The Supabase ones survived.
- **Object store and port.** `docker volume ls` before the rebuild listed no
  `zuri-minio-community-local-data` volume and `docker ps -a` no `zuri-minio-community-local`
  container. The container publishing `127.0.0.1:19000` belongs to a different compose project and
  was created at 2026-09-29T02:06Z (09:06 +07). The rebuilt store container was created at 05:54Z
  (12:54 +07).
- `docker events` does not keep history across engine restarts, so it cannot show what removed the
  `zuri-ai` objects.

## Root cause

1. **The watchdog wrote a file Docker owns, in an encoding Docker cannot read.** To protect against
   the 09-28 "hidden image store" failure, the watchdog set `UseContainerdSnapshotter` in Docker
   Desktop's settings file before every start, with a BOM (Evidence). While a rewrite with a BOM was
   in place, the backend crashed at startup, and the next check started it again. The start at about
   06:18 succeeded, which means a BOM-free settings file was in place by then. What rewrote it is
   **unverified**.
2. **The watchdog had no back-off and could force-stop a starting engine.** It restarted Docker
   Desktop without a limit, and after three unresponsive checks it stopped the process even when it
   was still starting. One failure became a five-hour loop.
3. **The zuri objects were removed selectively.** The `zuri-ai` compose project's containers,
   images and volumes are gone, and so is the separately started `zuri-minio-community-local`
   store; objects of other projects on the same engine (Supabase) survived.
   That pattern fits a project-scoped removal (for example a compose `down` with volumes and images,
   or a manual cleanup), not a Docker reset. **Who or what did it, and exactly when, is
   unverified.** The engine was down from about 01:15 to 06:18, so the removal happened either
   around 01:15 or after 06:18, most likely before 06:25 (see Evidence, which has the caveat).
4. **No backup of the ki17 volumes or the object store existed.** `ki17-state` (MSP and GKS
   SQLite stores), `ki17-genesis-store` (published generations) and the knowledge object store's
   data volume lived only on Docker's WSL2 data disk. The
   [deployment plan](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md) (§6) warns never to run
   `down -v`, but nothing enforced it and no copy existed elsewhere.

## Impact

- About 11 hours without web, the ngrok tunnel, LINE webhook intake, the LINE worker, the
  genesis-worker and the conversation runtime. The Zuri OA is the platform's internal test OA (4 to
  5 testers); no customer OA was connected. Whether the OA was producing replies before the outage
  is tracked separately in
  [the LINE OA RCA](2026-09-28-zuri-line-oa-silent-since-0914.md), which is still open.
- **Lost:** MSP conversation memory and journal, GKS decisions and receipts, the 22 published
  SmartGift knowledge generations, and every raw file in the knowledge object store. Knowledge
  queries failed until the records were published again.
- **Re-published:** the same 22 records, from files whose records are identical to the originals
  (verified against the benchmark fixture). Old source rows and their evidence stay in the database
  as withdrawn history (`revokedAt` set, ingestions `WITHDRAWN`); their raw files cannot be read back.
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

The watchdog script lives on the production host, outside this repository. It was changed as below
and re-enabled at about 12:39 with the owner's approval. Its normal path (health check, recovery
notice) has run; the outage path (the two-start limit, the missing-container alert and the hourly
alert) has **not** been exercised.

- It **only reads** Docker's settings file and alerts when the image store setting is off. It never
  writes it.
- It makes **at most two** automatic starts per outage, then alerts every hour and leaves recovery to
  a person. It never force-stops Docker Desktop.
- It alerts when a production container is **missing**, not only stopped.
- It leaves a paused container alone, so the backup's short pause of the worker is not treated as a
  failure.

## Proposed prevention

1. **Rule (proposed):** host automation must never write a file owned by another program. It reads
   and alerts, and any automatic restart has a fixed attempt limit per outage.
2. Back up `ki17-state`, `ki17-genesis-store` and the knowledge object store off the Docker disk
   on a schedule, and after every publication, with a documented restore that has been rehearsed
   once. **Partly done 2026-09-29:** every 6 hours to a separate drive on the same host, with SQLite
   online backup, integrity check and a SHA-256 manifest per run, and a restore of all three stores
   rehearsed into scratch volumes. Still pending: an automatic backup after each publication (one was taken by
   hand) and an off-host copy; the knowledge-storage README is explicit that an on-host copy is not
   a disaster-recovery copy.
3. Keep the production benchmark fixture's deployed copy somewhere durable.
   [§10.1](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md) already asks for a copy with every
   change; this time it survived only because an untracked file happened to exist.
4. Send watchdog alerts to a channel someone reads off the host, not only desktop notifications.
5. Add a reconciliation check that flags ingestions recorded as `PUBLISHED` when the genesis store
   holds no matching generation.
6. Find out what removed the `zuri-ai` objects: check the other automations and agent sessions
   active on the host that night, and turn on persistent Docker event logging.
7. Reserve host ports for production services, or move them off fixed loopback ports: a
   development stack took the knowledge store's port within hours of it being freed.

## Open follow-ups

- Done: the 22 SmartGift records are published again (owner approved 2026-09-29).
- Done: the repaired watchdog is re-enabled (owner approved 2026-09-29).
- The knowledge store is still the local Community smoke profile (see
  `apps/server/deploy/knowledge-storage/README.md`), now on port 19100; the production target
  remains pending.

## Follow-up (2026-09-30)

[The 09-30 RCA](2026-09-30-second-loss-docker-data-view-changed.md) adds three corrections. The
machine was restarted by a user at 05:27 on 09-29, inside this outage window, which this record
does not mention. The conversation memory counted as lost above still existed: the original
volumes reappeared on 09-30 and are archived (not merged). And "removed selectively by an unknown
actor" is not the only explanation any more: the engine may have presented a different set of
Docker data rather than deleted the first one. Neither reading is verified.
