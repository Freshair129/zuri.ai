---
version: "0.1.0b"
created_at: "2026-09-06T11:20:00+07:00,CLAUDE"
last_update: "2026-09-06T11:20:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "platform"
  doc_type: "root-cause-analysis"
  scope: "Two deletions in one session removed resources that were still in use, because every check asked whether the resource was tidy and none asked whether anyone was using it"
---

# RCA — two deletions of resources that were still in use

## Symptom

On 2026-09-06 the deploy session deleted two things it had described as unused.
Both were in use.

1. `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` (9.08 GB), reported to the
   owner as "a stale disk Docker Desktop left behind when it upgraded", deleted
   at 10:44 while the Docker daemon and the production containers were running.
2. The git worktree `C:\Users\pc\workspace\zuri-ai-artifactid-migration`,
   reported as "merged and clean", deleted at ~11:05 while another session was
   actively working in it.

Neither deletion cost committed work. Both were unsafe, and the second cost
another session roughly ten minutes and one `npm` install.

## What actually happened

### 1. The Docker data disk

Docker Desktop auto-updated to its single-distro layout that morning: the
`docker-desktop-data` WSL distro is gone and `wsl -l -v` lists only
`docker-desktop`. Every container, image, volume and build-cache byte was empty
afterwards, and production had to be rebuilt from source.

Two files remained under `%LOCALAPPDATA%\Docker\wsl\`:

| file | size at 10:35 | what it is |
|---|---|---|
| `main\ext4.vhdx` | ~100 MB | the `docker-desktop` distro's **OS** disk |
| `disk\docker_data.vhdx` | 9.08 GB | the Docker **data** disk, `/var/lib/docker` |

The session read the second as the leftover of the migration, on two pieces of
evidence, both real and both irrelevant:

- `Get-ChildItem HKCU:\...\Lxss` shows one distro whose `BasePath` is
  `...\wsl\main`. That registry names each distro's **OS** disk. A data disk
  attached to a distro never appears there, so its absence proves nothing.
- `docker info` reports `Docker Root Dir: /var/lib/docker`. That is the path
  **inside** the VM. It says nothing about which host file backs it.

The session then ran what it believed was a liveness check —
`[System.IO.File]::Open(path, 'Open', 'ReadWrite', 'None')` — and it
**succeeded**, which was reported to the owner as "not in use". The owner
authorised the deletion on that report.

After deletion: 9.08 GB of free space was reclaimed, a `docker_data.vhdx` was
present again at the same path within seconds, sized 4.4 GB — consistent with
the images and build cache actually held at that moment — and the running
containers never faltered. The same exclusive open now **fails** while a shared
read succeeds, which is the signature of a live, mounted disk.

**What this RCA cannot explain, and does not pretend to:** why the exclusive
open succeeded at 10:44 if the disk was already backing a running daemon. Two
readings survive — the daemon had not yet taken a host-level exclusive handle,
or the file deleted was a pre-migration copy that the storage layer replaced.
The evidence collected does not separate them, and the record says so rather
than inventing a mechanism. What is not in doubt: the path is the live data
disk, the "leftover" label was wrong, and the deletion was unsafe regardless of
which reading is true.

### 2. The worktree

`C:\Users\pc\workspace\zuri-ai-artifactid-migration` held the lane that produced
PR #233. Before removing it the session checked three things, and all three were
true:

- the branch tip was an ancestor of `origin/main` — merged;
- `git status --porcelain` was empty — nothing uncommitted;
- `node_modules` held 236 real directories and no junction, so a recursive
  delete could not reach the primary checkout's packages.

`git worktree remove` then deleted the contents, failed the final directory
removal with `Permission denied`, and left `git worktree list` no longer showing
the entry. Investigating the lock found nine live processes:

```
pid=22216  10:51:35  cd .../artifactid-migration && gh run watch 34009961731
pid=25248  10:56:38  cd .../artifactid-migration && gh run watch 34009961733
pid=10244  10:57:37  (four more, started one second before the query)
```

Another session was inside that directory watching the governance workflow for
the merge of its own PR, and was still issuing commands every minute.

PR #233 had merged minutes earlier. The session read "merged" as "finished".
They are not the same claim: a lane is at its busiest immediately after a merge,
when CI is still running against `main`.

## Root cause

**Every check asked whether the resource was tidy. None asked whether anyone was
using it.**

Merge status, working-tree cleanliness, junction layout and registry membership
are all *static* properties. They answer "is unsaved work stored here?" — a
question about the past. Deletion safety depends on a *liveness* property: "is a
process using this right now?" — a question about the present. The first can be
entirely reassuring while the second is fatal, and on 2026-09-06 it was, twice in
one hour.

The repository already contains the correct instinct, scoped too narrowly.
`CLAUDE.md` says of the primary checkout: *"if another session might be relying
on it staying still, say so before refreshing it."* That is a liveness question.
It is attached to one directory, so it was applied to that directory and to
nothing else — including a sibling worktree of the same repository, where the
identical hazard lives.

A contributing factor worth its own line: **`git worktree remove` can
half-succeed.** It deleted every file, failed to remove the directory, and still
left the administrative entry gone, so `git worktree list` reported the clean end
state while the disk showed a stripped directory. A command's own success message
and a follow-up listing agreed with each other and both were misleading; only
looking at the directory revealed the true state.

## What prevents a repeat

This is a discipline fix, and the record should be honest that it is not an
enforced one. A process table is runtime state on one machine; no preflight
check, CI job or unit test can read it. Nothing here is guarded by a gate. Two
things change instead:

1. **`CLAUDE.md` and `AGENTS.md` state the rule against shared resources
   generally, not against the primary checkout only** — before deleting or
   resetting anything another session could be inside (a worktree, a container,
   a volume, a disk image), establish that nobody is in it, and prefer asking
   over inferring.
2. **The rule names the probe**, because a rule that says "make sure" without
   saying how is the rule that was already present and already missed:

   ```powershell
   # Who is inside this directory right now? The probe must exclude its own
   # ancestry: the path it searches for is in the command line of the shell
   # running the search, so the naive form always finds itself.
   $procs = Get-CimInstance Win32_Process
   $mine  = @($PID); $cur = $procs | Where-Object ProcessId -eq $PID
   while ($cur -and $cur.ParentProcessId -and $mine -notcontains $cur.ParentProcessId) {
     $mine += $cur.ParentProcessId
     $cur   = $procs | Where-Object ProcessId -eq $cur.ParentProcessId
   }
   $procs | Where-Object { $_.CommandLine -like '*<path fragment>*' -and $mine -notcontains $_.ProcessId } |
     Select-Object ProcessId, CreationDate, CommandLine
   ```

   **This correction is itself part of the record.** The first version of this
   RCA shipped the naive one-liner, and the first thing it was used on — the
   author's own worktree, empty and already merged — came back with four
   occupants, all of them the probe's own shell chain. A check that always says
   "occupied" is a check that gets ignored, which is the same way the rule this
   RCA generalises had already been neutralised: present, correct, and never
   applied. Read a zero as "no evidence anyone is inside", not as "nobody is
   inside" — a session that entered the directory earlier and is now running a
   bare command no longer carries the path in its command line. Where the
   resource belongs to another lane, ask a person.

   ```powershell
   # Is this file live? A mounted disk image refuses an exclusive open and
   # accepts a shared read. Exclusive-open success is not proof of disuse.
   try { [System.IO.File]::Open($f,'Open','Read','ReadWrite').Close(); 'shared read OK' } catch { }
   try { [System.IO.File]::Open($f,'Open','ReadWrite','None').Close(); 'exclusive OK' } catch { 'exclusive REFUSED - in use' }
   ```

3. **Do not read `git worktree list` as proof that a worktree is gone.** Check the
   directory. The administrative entry and the files are removed by different
   steps, and the second can fail while the first succeeds.

## What went right, and was not skill

The attempted repair — `git worktree add` at the original path with the original
branch — **failed**, because by then the other session had rebuilt its own lane
there on a new branch (`fix/schema-migration-baseline-repayment`) with its
packages reinstalled. Had that command succeeded it would have overwritten their
new lane with a branch already merged, turning one lost install into a second,
worse incident. The safe outcome came from a collision check inside `git`, not
from judgement in the session.

The same pattern held for the disk: production survived because nothing of value
ever lives in Docker on this host — `DATABASE_URL` is Supabase, evidence is
Supabase Storage, and the bundled Postgres profile has never been switched on.
That is an architectural property, not a precaution anyone took that morning.

Both recoveries were luck. The rule above is what would have been skill.
