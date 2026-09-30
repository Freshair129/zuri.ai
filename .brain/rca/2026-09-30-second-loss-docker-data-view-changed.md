---
version: "0.1.0b"
created_at: "2026-09-30T22:20:00+07:00,MC0"
last_update: "2026-09-30T22:20:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Second loss of the production containers and images in two days, a different set of Docker volumes appearing, an unnoticed 12-hour outage, and the recovery from backup"
---

# RCA - Second loss: the engine came back showing different Docker data

Follows [the 09-29 RCA](2026-09-29-watchdog-crash-loop-and-ki17-volume-loss.md). The cause of this
event is **not known**; this record separates what was observed from what is inferred.

## Complexity and risk

- **Complexity:** C-2 - host operations, no product code change
- **Risk:** HIGH - production was offline for about 12 hours and nobody was alerted. The state it
  came back with was older than the state the day before, so a wrong recovery choice could have
  silently discarded either the old conversation memory or the newer knowledge publication

## Symptom

Around 09:30 +07:00 on 2026-09-30 the Docker engine answered again after a period in which Docker
Desktop was not running. None of the five production containers existed, and the site returned
nothing. The images, the local knowledge object store (container and data volume) and the local
Supabase stack were also absent. The production containers had been healthy until about 06:00.

## Timeline (+07:00)

| Time | Event |
|---|---|
| 09-29 12:40 - 09-30 06:00 | Production healthy on the rebuilt stack. The 6-hourly backup ran at 06:00 and succeeded (the worker container existed) |
| 09-30 06:50 | The watchdog found the engine down with Docker Desktop not running and started it (attempt 1 of 2) |
| 06:55 - 07:00 | The engine answered. The watchdog logged all five production containers as missing |
| 07:25 - 08:25 | Two more start attempts, then the watchdog stopped retrying as designed ("needs a human") |
| 09:25 - 09:30 | Another start; the engine answered again |
| 09:30 - 21:45 | The watchdog logged web health 0 every 5 minutes. The 12:00 and 18:00 backups failed because the worker container did not exist |
| about 11:45 | Containers of an unrelated development stack were started on this engine |
| 21:45 | The outage was noticed while starting a planned deploy; the backup failure was the first sign |
| 21:50 - 22:15 | Recovery (below) |

## Evidence

- **The watchdog log** has the timeline above. Its alerts are desktop notifications on the same
  host; the 12-hour outage produced no message anyone saw.
- **A different set of volumes was visible.** The three ki17 volumes were present but were the
  **original** ones (created 2026-09-17; the SQLite store's last write is 2026-09-29 01:14, the
  minute the 09-29 outage began), not the ones rebuilt on 09-29 (created that morning). The local
  Supabase volumes and the object store volume that existed on 09-29 were absent, and the volume
  list was much longer (43 volumes across other projects) than the six seen on 09-29.
- **The engine used the classic storage driver** (`overlay2`), not the containerd one it used on
  09-29. Docker Desktop's settings file still says the containerd store is on and has not changed
  since 09-29 00:50, and the containerd data folder inside the Docker VM is empty (4 KB).
- **One data disk** file (about 150 GB) and one WSL distribution exist, so this is not two disks
  chosen between by configuration.
- **A watchdog warning is unexplained.** At each start it logged "containerd setting is not true",
  but reading the same file with the same code now returns `True`. It may be a false alarm from
  reading the file while Docker Desktop was rewriting it; not verified.
- **No reboot** happened on 09-30 (the last one was 09-29 05:27, the day before).

## Root cause

**Unknown.** Established: after Docker Desktop restarted at about 06:50 the engine presented a
different volume and image set from the one it presented at 06:00. Not established: why, and
whether the earlier view still exists somewhere. Two facts constrain any explanation: the file the
engine uses is a single disk, and the original volumes' last writes are from 09-29 01:14, so the
view shown on 09-30 is the state from before the 09-29 outage, not from before 09-30 06:00.

## Impact

- About 12 hours without web, the tunnel, LINE webhook intake and all workers. The Zuri OA is the
  platform's internal test OA; no customer OA was connected.
- **Data:** the 06:00 backup restored everything that mattered to production state. Activity
  between 06:00 and about 06:50 on 09-30 (test conversations) is lost. The 22 SmartGift records
  and the object store came back from the backup and answer queries.
- **Recovered as a side effect:** the original conversation memory (about 200 MB, up to 09-29
  01:14) that the 09-29 RCA counted as lost still existed, and is now archived. It was not merged
  into production; that is an owner decision.

## Why detection escaped

- Watchdog alerts stay on the host as desktop notifications. Nothing outside the machine learns
  that production is down.
- The 09-29 prevention work (backup, watchdog) worked as designed, but the backup failing twice was
  logged only to a file.

## Fix applied (recovery)

1. Archived the two original volumes that were visible (state and genesis store) to a separate
   drive with SHA-256 hashes, before touching anything.
2. Restored the 06:00 backup into the production volumes (state, genesis store) and recreated the
   object store volume; the restore verified file hashes and SQLite integrity.
3. Rebuilt the images from `main` at the merge of the query-performance fix, rebuilt the object
   store image, and started all services. Health 200 locally and through the tunnel; the relay
   smoke check passes and the worker answers with a published generation; all 22 snapshots
   answer for five test queries.
4. Saved the built images to the separate drive (about 660 MB) so a recovery no longer needs a
   30-minute rebuild.

## Proposed prevention

1. **Alert off the host.** A production-down condition lasting more than 15 minutes must reach a
   person by a channel that does not depend on this machine (a LINE push or e-mail from a place
   that is not the affected host).
2. **Record the engine's view at every watchdog tick:** storage driver, container and volume
   counts, and the engine id, so the next change is timestamped and the cause can be found.
3. **One-command recovery** from the saved images and the latest backup, rehearsed once.
4. **Copy backups and saved images off the host.** They are on a second drive of the same machine.
5. Decide whether to pin the engine's storage driver explicitly in Docker's own configuration
   instead of relying on the settings UI (owner decision: it changes Docker's configuration).
6. Investigate the Docker Desktop version in use for data-disk handling after an abnormal stop.

## Open follow-ups

- Owner: decide what to do with the archived original conversation memory (keep archived, or plan
  a merge).
- Owner: decide on an off-host backup target and an alert channel.
- MC0: find out what changed the engine's view (proposal 2 will make the next occurrence
  diagnosable).
