---
version: "0.2.2b"
created_at: "2026-09-30T22:20:00+07:00,MC0"
last_update: "2026-10-01T00:05:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Second loss of the production containers and images in two days, the engine presenting a different set of Docker data, an unnoticed outage of about 15 hours, and the recovery from backup"
---

# RCA - Second loss: the engine came back showing different Docker data

Follows [the 09-29 RCA](2026-09-29-watchdog-crash-loop-and-ki17-volume-loss.md). The cause of this
event is **not known**. This record separates what was observed from what is inferred, and lists
the explanations that are still open.

## Complexity and risk

- **Complexity:** C-2 - host operations, no product code change
- **Risk:** HIGH - production was unreachable for about 15 hours and nobody was alerted. The data
  the engine showed was older than the day before, so a wrong recovery choice could have silently
  discarded either the old conversation memory or the newer knowledge publication

## Symptom

At 06:55 - 07:00 +07:00 on 2026-09-30, after the watchdog had started Docker Desktop, the engine
answered but none of the five production containers existed (watchdog log). That is the only thing
observed at that time. The site returned nothing until the recovery below.

At about 21:50, when the outage was noticed and recovery began, the images, the local knowledge
object store (container and data volume) and the local Supabase stack were also absent. That was
after Docker Desktop had been restarted at 09:49 and its VM at 11:26, so it is not known which of
those absences already held at 06:55. The last time the containers were known to exist was 06:00
(the scheduled backup ran and found the worker container).

## Timeline (+07:00)

| Time | Event |
|---|---|
| 09-29 13:24 - 09-30 06:00 | Production healthy on the stack rebuilt after the 09-29 outage. The 06:00 backup succeeded |
| 09-30 05:40 - 06:35 | (Correlation only) Another agent session ran cross-session Windows access tests on this host, including a temporary local user profile that shows up in the system log at 05:42 and is gone now. Whether it is related is **not known** |
| 06:50 | The watchdog found the engine down with Docker Desktop not running and started it (attempt 1 of 2). Why Docker Desktop had stopped is **not known** |
| 06:55 - 07:00 | The engine answered. The watchdog logged all five production containers as missing |
| 07:25, 07:30 | The engine was down again; the watchdog made attempts 1 and 2 of a new outage, then stopped retrying as designed ("needs a human") at 08:25 |
| 09:25 - 09:30 | The watchdog made attempt 1 of another outage; the engine answered. Docker Desktop's own process, started at 09:49, was not started by the watchdog; who or what started it is **not known** |
| 09:30 - 21:45 | The watchdog logged web health 0 every 5 minutes. The 12:00 and 18:00 backups failed because the worker container did not exist |
| 09:49 | Docker Desktop's install-settings file and the Docker VM's root disk were rewritten (VM root disk created 09:49) |
| 11:26 | The Docker VM was started again; containers of an unrelated development stack were started on the engine at about 11:45 |
| 21:45 | The outage was noticed while starting a planned deploy; the backup failure was the first sign |
| 21:50 - 22:15 | Recovery (below) |

The unreachable period is about 15 hours (from the 06:50 stop to the 22:15 recovery). The watchdog's
"web health 0" lines only cover 09:30 onward, so a count taken from them understates it.

## Evidence

- **The watchdog log** has the events above. Its alerts are desktop notifications on the same
  host; the outage produced no message anyone saw.
- **The volumes shown were the original ones** (observed at about 21:50, during recovery, after the
  09:49 and 11:26 restarts). The three ki17 volumes were present but were the
  ones created on 2026-09-17, not the ones rebuilt on 09-29 (created that morning). The SQLite
  store's last write is 09-29 01:14, the minute the 09-29 outage began. The local Supabase volumes
  and the object store volume that existed on 09-29 were absent, and 43 volumes across other
  projects were listed, where on 09-29 the list held only the local Supabase volumes plus the ki17
  volumes rebuilt that day. No volume listing was taken at 06:55, so it is not known that this view
  already existed then; the ki17 volumes have no writes after 09-29 01:14, which is consistent with
  it but does not prove it.
- **This does not fit a simple rollback.** A rollback to the state at 09-29 01:14 would have
  brought back the local Supabase volumes too, and they were absent at 21:50 (the 09:49 root-disk
  recreation could account for their absence as well). It does not fit a plain
  deletion either, because the original volumes reappeared.
- **The engine used the classic storage driver** (`overlay2`), not the containerd one it used on
  09-29, and the containerd data folder inside the Docker VM was empty (4 KB), both observed at about
  21:50. The empty folder may date from the 09:49 recreation of the VM root disk or the 11:26 VM
  start rather than from 06:50. Docker Desktop 4.93.0.
- **Docker's settings folder does not look like the state the 09-29 outage left** (file times read at
  about 21:50). The watchdog's own
  backups of `settings-store.json` show it was rewritten repeatedly until 06:10 on 09-29. The live
  file has a creation time and a last-write time that are both 09-29 00:50:47, before the first of
  those rewrites, and it has no BOM and reads `true` for the containerd setting. Several other
  small files in that folder also carry start-of-day times from 09-28 04:50 and 09-29 00:50. So
  the folder appears to have been replaced by an older copy, or reinstalled, at some point after
  06:15 on 09-29. **Which, when and by what is not known.**
- **A watchdog warning has two readings.** At each start on 09-30 the watchdog logged "the
  containerd setting is not true". Reading the same file now returns `true`. Either (a) the
  watchdog read the file while it was being rewritten and got nothing, so the warning was false,
  or (b) the file really lacked the setting at those moments, which is the 09-28 failure mode,
  and was later replaced. Both are unverified.
- **One data-disk file and one WSL distribution were found** for the user that owns Docker
  Desktop, so the engine did not obviously choose between two disks. A restore or replacement of
  the disk, or a different daemon behind the same pipe, are not ruled out. Windows creates a
  restore point for updates, but no restore event was found in the system or application logs for
  that window (listing restore points needs elevation and was not done).
- **A reboot happened on 09-29 at 05:27** (a user-initiated restart), inside the 09-29 outage
  window. The 09-29 RCA does not mention it. No reboot happened on 09-30, which rules out a reboot
  as the trigger of the 06:50 stop. It does not rule out a logoff, a sleep, or Docker Desktop being
  closed or crashing on its own.

## Root cause

**Unknown.** Established: at 06:55 - 07:00 the engine answered with none of the five production
containers (watchdog log); at about 21:50 it showed the original ki17 volumes, none of the 09-29
rebuild, the classic storage driver, and a Docker settings folder whose file times pre-date the end
of 09-29. Not established: whether that view was already present at 06:55 (the 09:49 and 11:26
restarts came in between), what changed it (from file times the settings folder *appears* to have
been replaced by an older copy or reinstalled), and whether the earlier view (with the 09-29
rebuild) still exists anywhere.

Open explanations, none verified: an older copy of Docker's configuration and data was restored by
some tool or person; Docker Desktop was reinstalled or updated at 09:49 and reset itself (this alone
cannot explain the missing containers at 06:55); a concurrent agent session's Windows access tests
interfered with the Docker Desktop process or its pipe; a second Docker engine answered on the same
pipe; the watchdog's own starts, or an unattended Docker Desktop update, contributed (the watchdog
caused the 09-29 loop, and although it no longer writes Docker's settings, its starts continue).

## Impact

- About 15 hours without web, the tunnel, LINE webhook intake and all workers. The Zuri OA is the
  platform's internal test OA; no customer OA was connected.
- **Data:** the 06:00 backup restored production's state (SQLite stores, the published knowledge
  store, and the object store). Activity between 06:00 and about 06:50 (test conversations) is
  lost. The 22 SmartGift records and their raw files came back and answered five test queries.
  The model volume was not touched; the worker started and passed its start-up verification of the
  five model files.
- **Also found, not merged:** the original conversation memory (about 200 MB, up to 09-29 01:14),
  which the 09-29 RCA counted as lost, still existed. It and the original genesis store (the
  22 generations published on 09-21, per [the 09-24 probe](../reports/2026-09-24-genesisrag17-production-probe.md);
  their sources were withdrawn in the 09-29 re-publish) are archived and hashed. Neither was merged into production; that is an owner decision.

## Why detection escaped

- Watchdog alerts stay on the host as desktop notifications. Nothing outside the machine learns
  that production is down. This was already a 09-29 finding and is still open.
- The scheduled backup failing twice was logged only to a file.
- The watchdog made four starts (06:50, 07:25, 07:30, 09:25) in about three hours. Its limit of two
  applies per outage and resets whenever the engine answers, so it did not stop this sequence; it
  only limits retries and reports nothing outside the host.

## Fix applied (recovery)

1. Archived the two original volumes that were visible (state and genesis store) to a second
   drive with SHA-256 hashes before touching anything.
2. Restored the 06:00 backup into the production volumes and recreated the object store volume;
   the restore verified file hashes and SQLite integrity.
3. Rebuilt the images from `main` at `b83def06` (the merge of the query-performance fix) and the
   object store image, and started all services. Health 200 locally and through the tunnel;
   `ki17-smoke` passes and the worker answers with a published generation; all 22 snapshots
   answered for five test queries.
4. Saved the built images to the second drive (about 660 MB) so a recovery no longer needs a
   30-minute rebuild.

## Proposed prevention

Items marked **carry-over** were already proposed on 09-29 and are still open.

1. **Alert off the host (carry-over, 09-29 item 4).** Production down for more than 15 minutes
   must reach a person by a channel that does not depend on this machine. Owner: user picks the
   channel; MC0 implements. Done when a simulated outage produces a message on a phone.
2. **Record the engine's view at every watchdog check:** storage driver, container and volume
   counts, engine id, and the modification time of Docker's settings file (overlaps 09-29 item 6,
   persistent Docker event logging). Owner: MC0. Done when the log shows those fields each check.
3. **One-command recovery** from the saved images and the latest backup, rehearsed once. Owner:
   MC0. Done when a rehearsal into scratch names restores a working stack.
4. **Copy backups and saved images off the host (carry-over, 09-29 item 2).** They are on a second
   drive of the same machine. Owner: user picks the target; MC0 implements.
5. **Ask the lane that ran the cross-session tests** whether they touched Docker Desktop, its pipe
   or its data around 05:40 - 06:50 on 09-30, and record the answer here. Owner: MC0.
6. **Docker configuration.** Whether to pin the engine's storage driver in Docker's own
   configuration is an owner decision; the 09-29 rule that host automation must not write files
   Docker owns still applies, so it would be a manual change. The premise is weak (the setting was
   already on and the engine still used the classic store). Also investigate what Docker Desktop
   4.93.0 does to its configuration and data after an abnormal stop.

## Open follow-ups

- Owner: decide what to do with the archived original conversation memory and knowledge store
  (keep archived, or plan a merge).
- Owner: decide on an off-host backup target and an alert channel.
- MC0: find out what changed the engine's view (prevention 2 and 5).
