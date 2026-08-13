# FR-045 W2 report — path security and filesystem port

**Status:** DONE — focused W2 security and port contract is green

## Scope

- `src/modules/project-manager/local-files/` only (new modules)
- `tests/unit/fr045-path-security.test.js`
- `tests/unit/fr045-filesystem-port.test.js`
- this report

## RED evidence

`npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js`
was run before any W2 implementation. It exited `1` during the repository global
setup, before test collection: concurrent W1 schema changes reference
`LocalWorkspaceMount` and `FileAsset` before those models exist, so Prisma reports
P1012. This is outside W2 exclusive ownership. The direct module import check below
records the expected W2-specific RED condition: the `path-security` and
`filesystem-port` modules do not yet exist.

Direct RED command (run before implementation):

```powershell
node --input-type=module -e "await import('./src/modules/project-manager/local-files/path-security.js')"
```

Result: exit `1`, `ERR_MODULE_NOT_FOUND` for `path-security.js`. This is the
W2-specific failing reason; no implementation module existed.

## GREEN evidence

Minimal W2 implementation now exists in:

- `src/modules/project-manager/local-files/path-security.js`
- `src/modules/project-manager/local-files/filesystem-port.js`

Direct no-Prisma invocation passed after GREEN. It checks portable normalization,
absolute/traversal/UNC/drive-relative rejection, injected final-real-path escape,
and staged promotion through injected filesystem functions.

After W1 completed its schema models, the normal focused suite also passed:

```text
npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js
2 test files passed; 18 tests passed
```

## Implementation boundary

`path-security.js` normalizes portable client-relative paths, rejects empty,
absolute, UNC, drive-relative, null-byte and `..` input, then verifies lexical and
injected final-real-path containment with Windows (`path.win32`) semantics.
`filesystem-port.js` is an injected `node:fs/promises` adapter for staged write,
atomic `rename` promotion, read/stat and cleanup. It validates the final write
parent before promotion and the final file after promotion. It intentionally has
no Prisma import, authorization inference, route/UI code, cache, watcher, Explorer
launch or external-mock access.

## Commands and results

| Command | Result |
|---|---|
| `node --input-type=module -e "await import('./src/modules/project-manager/local-files/path-security.js')"` (before code) | RED: exit 1, `ERR_MODULE_NOT_FOUND` |
| Direct Node assertion script for path and port behavior | GREEN: passed (no filesystem mutation; injected doubles) |
| `npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js` | GREEN: 2 files / 18 tests passed |
| `git diff --check` | passed with no output |

## Files created

- `src/modules/project-manager/local-files/path-security.js`
- `src/modules/project-manager/local-files/filesystem-port.js`
- `tests/unit/fr045-path-security.test.js`
- `tests/unit/fr045-filesystem-port.test.js`
- `docs/.rwang-tasks/fr045-w2-report.md`

## Concerns

- The first standard Vitest RED run was blocked by W1's in-flight incomplete Prisma
  schema (P1012) before test collection. This is dependency evidence, not W2 RED;
  the direct module import provided the W2-specific RED proof. The same standard
  focused suite passed once W1's models were present.
- This port enforces only containment. Tenant/Business/Project authorization,
  content hashing, audit/reconciliation and local-reveal capability gates remain
  deliberately owned by later integration work.

---

## Independent Review Gate - W2

**Reviewer:** ATHER (independent W2 security/API review)
**Reviewed:** 2026-08-14 (ICT)
**Scope:** review-only; no implementation or test changes.

| # | Rubric | Result | Evidence |
|---|---|---|---|
| 1 | Client-relative input denial | PASS | `normalizeClientRelativePath` rejects empty/blank, `..` traversal, POSIX-rooted, Windows-rooted, drive-absolute, drive-relative, UNC, extended-drive and null-byte inputs. It returns portable `/` separators only for non-empty relative paths. Focused unit coverage includes the Windows forms named in the W2 brief. |
| 2 | Lexical and final-real-path containment | FAIL | Lexical containment is correct and `resolveContainedPath`/`resolveContainedWritePath` inject and validate `realpath`; the focused suite proves a read is denied before `readFile` on final-path escape. However, `promote` performs `rename` before its final `resolveContainedPath` check. A focused injected-realpath review probe made the post-rename final path resolve to `D:\\outside\\brief.pdf`: it threw `LocalPathSecurityError`, but the call order was `mkdir`, then `rename`. Thus a reparse/TOCTOU escape can move content outside the mount before the operation fails, which does not satisfy fail-closed containment for promotion. |
| 3 | Windows path and case behavior | PASS | The implementation consistently uses `path.win32`; its descendant test uses `win32.relative`, which treats equivalent drive/root casing as contained. A focused case-variant smoke check resolved `D:\\Zuri-Workspace\\Client-01` against lower-case real paths successfully without weakening the outside-root check. |
| 4 | Filesystem-port contract and atomicity | WARN | The injectable port supplies staged write, `rename` promotion, read, stat, mounted cleanup and staged cleanup, and does not synthesize the caller-provided staging root/name. `rename` is the correct same-volume atomic primitive, but the port neither constrains staging root to the mount nor documents/enforces the same-volume prerequisite; cross-volume caller input fails rather than providing a defined recoverable result. The post-rename containment failure above is the blocking part of this rubric. |
| 5 | Fail-closed errors and scope boundary | FAIL | Invalid paths and pre-I/O read escape are rejected with `LocalPathSecurityError`; no Prisma/auth inference, watcher, Explorer/reveal, cache or external-mock code appears in either W2 module. Promotion nevertheless mutates the destination before reporting a final-path escape, so the aggregate fail-closed requirement is not met. |
| 6 | TDD evidence, focused verification and exclusive W2 scope | WARN | Current verification passed: `npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js` - 2 files / 18 tests; `git diff --check` - pass. The writer records a module-not-found RED check, but it is author-reported and not independently replayable from history. The focused tests also do not cover pre-rename parent-realpath escape, post-rename escape/recovery, staged-root reparse behavior, or the observed case variant. W2-owned artifacts themselves are confined to the declared local-files/test/report lane; the larger dirty worktree belongs to concurrent lanes. |

**Verdict: FAIL** - Input normalization, lexical checks, Windows semantics and the minimal injected port API are sound, and the focused suite is green. Do not promote W2 as SEC-007-complete until `promote` cannot leave content outside the mount when the final resolved destination escapes (including a deterministic recovery/cleanup rule), and the missing security-path tests are added. TDD RED evidence remains non-reproducible from repository history.

---

## W2 remediation evidence â€” 2026-08-14 (ICT)

The promotion hard failure above is fixed in the W2-exclusive modules and tests.

### RED regression

Added `does not rename when the destination parent resolves outside the mount after
creation` to `tests/unit/fr045-filesystem-port.test.js`. Its injected filesystem
double changes the destination parent into a reparse escape immediately after
`mkdir`. Against the prior implementation the assertion failed exactly as expected:
the promise rejected only after `fs.rename` had been called once with the lexical
destination. This is deterministic proof of the reviewed defect.

### Safe promotion shape

`promote` now:

1. validates the lexical client-relative destination and creates its lexical parent;
2. resolves the mount root and that parent *after* creation, immediately before
   mutation, then rejects containment escape;
3. constructs the rename destination from the verified real parent plus the already
   validated filename, rather than using the untrusted lexical destination;
4. resolves the staged file under its staging root and rejects differing canonical
   Windows volume roots before `rename`.

There is no copy/delete fallback: atomic promotion requires staged content and the
verified destination to be on the same canonical Windows volume. A cross-volume
pair fails closed before `rename`; callers must choose same-volume staging.
Post-rename final-path validation is no longer the primary containment control.

### GREEN verification

```text
npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js
2 test files passed; 21 tests passed
```

The focused port tests now cover: missing destination-parent creation, injected
post-creation destination-parent reparse escape with zero rename calls, canonical
real-parent destination construction, and cross-volume rejection with zero rename
calls. `git diff --check` also passed with no output.

---

## W2 re-review - 2026-08-14 (ICT)

**Reviewer:** ATHER (independent remediation re-review)
**Scope:** `path-security.js`, `filesystem-port.js`, their two W2 unit suites, and
the original W2 brief / prior independent-review failure only. No code or test was
changed during this review.

| Check | Result | Evidence |
|---|---|---|
| Post-mkdir reparse escape is fail-closed before mutation | PASS | `promote` creates the lexical parent, then calls `resolveContainedWritePath` before `rename`. The injected post-creation reparse test rejects `final real path escapes mounted root` and asserts `fs.rename` was not called. |
| Rename target uses canonical verified parent | PASS | `resolveContainedWritePath` returns `win32.join(realParent, basename(...))`; the focused alias test verifies rename to `D:\\zuri-workspace\\client-01\\canonical\\Documents\\brief.pdf`, not the lexical alias. |
| Same-volume promotion is required | PASS | Canonical staged and destination paths are checked with `assertSameWindowsVolume` before `rename`. The cross-volume injection rejects with `staging and destination must be on the same volume` and asserts zero rename calls. |
| No copy/delete promotion fallback | PASS | Promotion has one mutating promotion primitive, `fs.rename`; no copy/unlink/delete fallback exists. `rm` is confined to explicit cleanup methods. |
| Original client/path cases remain green | PASS | `npm test -- tests/unit/fr045-path-security.test.js tests/unit/fr045-filesystem-port.test.js` passed: 2 files, 21 tests. This includes Windows absolute/drive-relative/UNC/extended-path, traversal, empty/null-byte, lexical containment, and existing-final-path reparse cases. |
| Remediation scope | PASS | The W2 local-files directory contains only `path-security.js` and `filesystem-port.js`; the remediation test lane is limited to the two declared W2 unit files and this report. No Prisma, authorization, watcher, Explorer, cache, or external-mock behavior was added. |

**Verdict: ALL PASS.** The remediation directly closes the prior FAIL: an injected
reparse escape introduced after destination-parent creation now prevents any rename,
and valid promotion targets the verified canonical parent on the same volume. The
focused W2 suite is green (21/21); `git diff --check` passed.
