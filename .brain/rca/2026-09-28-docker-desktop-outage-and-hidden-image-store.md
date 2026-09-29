---
version: "0.1.0b"
created_at: "2026-09-28T07:30:00+07:00,MC0"
last_update: "2026-09-28T07:30:00+07:00,MC0"
status: "under review"
attributes:
  domain: "production-host"
  doc_type: "root-cause-analysis"
  scope: "Docker Desktop stop, startup crash loop and hidden images on the single production host"
---

# RCA - Docker Desktop outage, startup crash and hidden image store

## Complexity and risk

- **Complexity:** C-2 - host operations, no code change
- **Risk:** HIGH - the single production host runs web, the LINE worker and ngrok on Docker Desktop

## Symptom

On 2026-09-28, about 04:45 +07:00, `docker info` failed on the Desktop engine pipe and the
`docker-desktop` WSL distro was `Stopped`. Web, the LINE worker and the ngrok tunnel were offline.
The machine had not rebooted.

## Timeline and causes

1. **Docker Desktop stopped by itself.** The cause is unknown: the logs from before the stop had
   rotated away.
2. **The restart crashed.** Docker Desktop renames the old socket files in its per-user `run`
   folder to `*.stale` on each start. One AF_UNIX socket (`sailor-ingest.sock`) had become a broken
   reparse point that Windows could neither rename nor delete ("The file cannot be accessed by the
   system"). The folder held `.stale.stale…` files dating back to 2026-09-20, so this had been
   building for days.
3. **Images and containers vanished after the restart.** The Docker Desktop settings store had
   been reset to 6 keys. That dropped `UseContainerdSnapshotter`, so the engine came up on the
   classic `overlay2` store (0 images, 0 containers). Every image (about 110 GB) and all 27
   containers lived in the containerd store. No data was lost.

## Fix applied

- Renamed the broken `run` folder to `run.broken-20260928`. Docker Desktop created a fresh one.
  Deleting the folder needs a reboot.
- Restored `UseContainerdSnapshotter: true` in the settings store and restarted Docker Desktop.
  161 images and 27 containers came back. The production containers restarted under their
  `unless-stopped` policy.
- Verified: web health 200, line-worker ticking, genesis-worker healthy, `ki17-smoke` PASS.

## Prevention (done)

- Docker Desktop now starts when the user signs in: `AutoStart` is set in the settings store and a
  per-user Run entry was added.
- A scheduled task, `Zuri Docker Watchdog`, runs every 5 minutes. It restarts Docker Desktop when
  the daemon is down. Before each start it moves a `run` folder holding stale sockets aside and
  restores the containerd and AutoStart settings. It also force-restarts a daemon that hangs for 3
  checks, and starts stopped production containers after 2 failed health checks.
  **Superseded 2026-09-29:** this watchdog caused the next outage. Its settings rewrite added a BOM
  that Docker Desktop cannot parse, and it restarted without a limit. It was disabled and changed to
  read and alert only; see [the 09-29 RCA](2026-09-29-watchdog-crash-loop-and-ki17-volume-loss.md).
- Other Docker Desktop settings the reset may have cleared (CPU/RAM limits, WSL integration, proxy)
  are still for the owner to check.

## Remaining risk

- The root cause of the stop is unknown.
- The host needs an interactive sign-in after a reboot, because Docker Desktop runs per user.
  Automatic sign-in is a security setting and the owner's decision.
- After any web container recreate, genesis-worker must be force-recreated, because it shares
  web's network namespace (RCA 2026-09-22). Otherwise `ki17-smoke` fails on the worker hop.
