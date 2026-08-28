---
version: "0.1.0b"
created_at: "2026-08-28T00:00:00+07:00,CLAUDE"
last_update: "2026-08-28T00:00:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "developer-experience"
  doc_type: "root-cause-analysis"
  scope: "D:\\zuri-ai's checked-out branch, index and working tree are global mutable state shared by concurrent sessions, with no gate on writing to any of it"
---

# RCA — the primary checkout is not a lane, but nothing said so

## The question

`D:\zuri-ai` is one git working copy. Several Claude Code sessions use it
concurrently — some in the primary, some in one of the sibling worktrees
already checked out beside it. On 2026-08-28, two sessions collided in it
twice within minutes, and a third, earlier incident had already cost two
permanently lost edits. The question this RCA answers: why did nothing stop
a session from mutating branch, index or working tree state that another
session was relying on?

The answer is that the primary checkout carried no rule against writing to
it, no hook could have enforced one if it had, and the safe alternative
(a worktree) was more expensive to use than the dangerous one.

## Incident 1 — a fast-forward on the wrong branch

Session X finished a PR on `docs/roadmap-tier1-correction` and left the tree
checked out there, clean. Session Y's next command, `git merge origin/main`,
was intended for Y's own feature branch but ran against X's, because the
checkout Y typed into was still sitting on X's branch. Git fast-forwarded it
without complaint — a fast-forward does not require the branch belong to the
session invoking it.

This was harmless only by accident: X's branch was already merged and the
tree was clean, so the fast-forward moved a ref nobody needed any more. Y
noticed at all only because the output read `Fast-forward` where a real
three-way merge was expected. That mismatch is not a designed signal — it is
a side effect of X's branch being ahead of Y's expectation, and it would not
have appeared had the branches diverged instead of one being a strict subset
of the other.

## Incident 2 — the reverse, minutes later

X did a conflict-resolution pass in the primary and left the tree on X's own
branch. Y was, at that point, unknowingly operating on X's branch — every
command Y ran next would have committed, or could have reset, work under a
branch name that belonged to someone else's task. X discovered the swap by
running `git branch --show-current` and seeing a name that was not X's.

Both incidents 1 and 2 share the same mechanism: the checked-out branch is
not an attribute of the session working in it, it is an attribute of the
directory, and two sessions were treating it as if it were the former.

## Incident 3 — the one that actually lost work

Earlier in the project, a `git stash` run across a peer's checkout in the
same shared primary permanently dropped two edits to
`docs/PRD-SDD-v1.0.md`. The recovery is on record:

```
$ git log --all --oneline --grep "stash lost"
89c7367 test(knowledge): pin the pipe guard, and restore two edits a stash lost
```

The commit message confirms both the loss and the manual recovery: the two
edits were restored by hand from memory of what they had said, not from any
git mechanism, because the stash that held them did not survive the
round-trip intact. This incident predates 1 and 2 and is the reason the
other two are being treated as a pattern rather than one-off bad luck: the
directory had already destroyed uncommitted work once, silently, before it
did the two branch-swap near-misses.

## Standing exposure, verified at time of writing

```
$ git stash list | wc -l
17
```

Seventeen stashes sit unexamined in the primary right now — in the exact
mechanism that already caused a permanent loss once. Any session's
`git stash clear`, or a `git stash pop` that collides with a dirty tree
another session left behind, would take some or all of it. Nothing marks
whose work is in which entry.

## The finding that matters most — worktrees were not the missing knowledge

```
$ git worktree list
D:/zuri-ai          [main]              ← primary
D:/zuri-ai-deploy    (detached HEAD)
D:/zuri-ai-failopen  [fix/agent-sensitivity-fail-open]
D:/zuri-ai-fr066     [feat/fr066-067-onboarding]
D:/zuri-ai-fr106     [feat/fr106-enterprise-api-auth]
D:/zuri-ai-fr107     (detached HEAD)
D:/zuri-ai-fr108     [feat/fr108-execution-plan-bundle]
D:/zuri-ai-githook   [chore/primary-git-guard]
D:/zuri-ai-graphrag  [verify-main]
D:/zuri-ai-regen     [chore/primary-is-not-a-lane]
D:/zuri-ai-stage5    [feat/fr111-classification]
```

Nine sibling worktrees already existed alongside the primary when incidents
1 and 2 happened, and both sessions involved knew worktrees existed and used
them routinely elsewhere in the same day. So the missing rule was never "use
worktrees" — both sessions already did, for other tasks. The missing rule was
"don't use the primary for a task that writes", and neither session had it,
because nothing said it and nothing would have stopped them if it had been
said.

The reason the primary got used anyway is economic, not a knowledge gap: it
is zero-setup and already has a working `node_modules` —

```
$ du -sh node_modules
763M    node_modules
```

— while a fresh worktree needs either that same 763 MB installed again or a
junction back to the primary's copy, and the junction carries its own
documented hazards (a careless `rm -rf` on a junctioned worktree destroys the
primary's `node_modules`, and a junctioned `node_modules` breaks real-database
Vitest runs inside the worktree unless it is un-junctioned and reinstalled
first). **The sanctioned path was more expensive than the dangerous one**, so
under time pressure the dangerous one is what got used, by sessions that knew
better in the abstract.

## Why no automated guard caught any of this

```
$ ls .git/hooks
applypatch-msg.sample   pre-applypatch.sample     pre-rebase.sample
commit-msg.sample       pre-commit.sample         pre-receive.sample
fsmonitor-watchman.sample  pre-merge-commit.sample sendemail-validate.sample
post-update.sample      pre-push.sample           update.sample

$ git config core.hooksPath
(unset)
```

No hook is installed — every file present is a `.sample` git ships by
default and nobody activated. But installing them would not have been
enough, because git structurally does not offer a hook for the operations
that actually caused harm:

- **`pre-commit` does not fire on a fast-forward merge.** Incident 1 created
  no new commit; it only moved a ref. There is no commit for a commit hook
  to inspect.
- **Git provides no hook at all for `reset --hard` or for `stash`.** Incident
  3, the one that destroyed real work, ran through exactly the mechanism git
  gives no hook for.

A git hook, installed with perfect judgment, would have caught only
incident 2's underlying pattern indirectly (by refusing a *commit* on the
wrong branch) and would have caught neither incident 1 nor incident 3 — the
fast-forward and the stash loss, the two that actually moved or destroyed
something. The least dangerous of the three incidents is the only one a git
hook can see.

## What changed as a result

PR #149 (`chore/primary-is-not-a-lane`, merged into `main` as
`73431a4`) adds the rule to `CLAUDE.md`: `D:\zuri-ai` is not a working lane,
no git write command belongs there — commit, merge, rebase, checkout, reset,
and above all stash — and any lane that writes takes a worktree. The primary
is also being moved to a permanent detached HEAD at `origin/main` so that no
branch name is ever "whoever happens to be checked out there right now."

A second, still-uncommitted change on branch `chore/primary-git-guard` adds
a Claude Code `PreToolUse` hook (`.claude/settings.json`) that intercepts
every `Bash` tool call, resolves the effective working directory (following
a leading `cd` in the command string), and denies the call outright when
that directory is the primary and the command is `git commit`, `merge`,
`rebase`, `reset`, `switch`, `restore`, `clean`, `am`, `apply`,
`cherry-pick`, `checkout`, a non-`list` `stash`, a force `push`, or a
branch-deleting `branch`. This is the harness's own hook layer, not git's —
and it can see what a git hook cannot, because it intercepts the agent's
tool call *before* the shell runs it, rather than waiting for git to reach a
lifecycle point that a fast-forward or a stash never reaches.

**Record honestly what the detached HEAD does and does not do.** It protects
*refs*, not *files*. It stops a stray `merge` or `reset --hard` from moving
somebody's branch pointer, because there is no branch pointer attached to
move. It does nothing to stop `stash`, `reset --hard`, or `checkout -- .`
from destroying a peer's uncommitted working-tree edits — those commands
operate on the working tree and index directly, independent of whether HEAD
is attached to a branch. **Incident 3, the one that caused permanent loss,
is the one the detached-HEAD mechanism does not address.** Only the
`PreToolUse` hook's explicit denial of `stash` (and of `reset`, `clean`,
`checkout -- .`-style restores) reaches that case, and that hook is still
uncommitted, unmerged, and not yet protecting anyone.

## Not fixed, recorded

- **The `PreToolUse` hook is not yet landed.** It exists as an untracked
  `.claude/settings.json` in the `chore/primary-git-guard` worktree, with no
  open pull request as of this writing. Until it merges, the only thing
  stopping a write to the primary is the written rule in `CLAUDE.md` — the
  same category of protection ("nothing stops you, only landing is gated")
  that a prior RCA in this file found insufficient for doc-before-code.
- **The hook covers the Bash tool's git invocations, not every path to
  git.** Any other route to running git against the primary's working
  directory — a different tool, a script that shells out on its own,
  a human running a terminal in that folder — is outside what a
  `PreToolUse` hook on `Bash` can see.
- **Seventeen stashes remain unexamined.** Nothing in this change inventories
  or clears them; they are still sitting in the mechanism that already lost
  work once, and the fix that would prevent *future* stash loss does not
  recover or protect what is already stashed today.
- **The junction hazard for `node_modules` in a fresh worktree is documented
  elsewhere in this repo, not resolved here.** The economic pressure that
  put both incidents in the primary — a real install costing 763 MB versus a
  junction that is fast but breaks real-database Vitest runs and can be
  destroyed by a careless `rm -rf` — is unchanged by this PR. The rule now
  says take a worktree; it does not make taking one as cheap as not doing so.

## Prevention

1. **A shared mutable directory needs a stated owner-of-the-moment or it has
   none.** `D:\zuri-ai`'s branch, index and tree were global state with no
   session ever holding exclusive claim to them; two sessions each assumed
   the checkout reflected their own intent, and both were sometimes wrong.
2. **Git hooks cannot be the enforcement layer for operations git gives no
   hook for.** `stash` and `reset --hard` are exactly the two commands with
   the worst failure mode here, and exactly the two hooks cannot see. A
   guard has to sit above git — in the tool-call layer, or in a wrapper —
   for those cases specifically.
3. **A safe path that costs more than the dangerous one will lose.** Telling
   people to use worktrees when the primary already has a warm
   `node_modules` and a worktree does not is not a policy failure, it is an
   incentive failure; nine worktrees already existing did not change the
   incentive, because the expensive part was never *making* the worktree,
   it was *provisioning* it.
4. **Blast-radius reduction is not the same claim as prevention, and a
   record of a fix should say which one it made.** The detached HEAD stops
   the more visible failure (a moved branch) and is silent on the more
   damaging one (destroyed uncommitted edits) — write that distinction down
   next to the fix, not just in this RCA, so the next reader does not assume
   detachment covers `stash` because it covers `merge`.
