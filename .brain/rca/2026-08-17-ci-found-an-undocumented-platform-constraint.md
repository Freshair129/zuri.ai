---
version: "0.1.0b"
created_at: "2026-08-17T01:10:00+07:00,CLAUDE"
last_update: "2026-08-17T01:10:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "CI's first run found a Windows-only dependency nothing had written down"
---

# Incident — the first CI run failed, and it was right to

## What happened

CI was added on 2026-08-17 to close a governance hole. Its **first run failed**,
on a branch whose suite was 783 green locally:

```
FAIL tests/integration/fr045-managed-files.test.js
Error: ENOENT: no such file or directory, realpath '\tmp\zuri-fr045-2ywuUk'
Error: ENOENT: rename '/tmp/zuri-fr045-2ywuUk/Projects/report.txt' -> '.../moved.txt'
Tests  2 failed | 781 passed
```

Note the mixed separators. The temp directory the test created was
`/tmp/zuri-fr045-…`; by the time `realpath` saw it, it was `\tmp\zuri-fr045-…`.

## Root cause — not a bug, an undocumented constraint

Three files under `src/modules/project-manager/local-files/` bind Windows path
semantics deliberately:

```js
// path-security.js:6, filesystem-port.js:15, file-reconcile-cache-service.js:13
const windowsPath = path.win32
```

That is a **security decision, not an oversight**. SEC-007 requires mounted-root
containment that survives drive letters, UNC roots, and junction/reparse
redirection — Windows-specific escape vectors that `path.posix` cannot reason
about. Using `path.win32` explicitly is how the containment proof stays sound.

The consequence is that the managed local workspace is a **Windows-only
capability**. On Linux those helpers rewrite `/tmp/x` to `\tmp\x`, and FR-045's
integration tests fail exactly as CI showed.

**Nothing said so.** SDD-023 spoke of a "device-local absolute root"; SEC-007
mentioned "junction/reparse" without naming the platform it implies; ADR-016 and
the project-manager charter were silent. The constraint had been true since
FR-045 landed and was invisible because every machine that ran the suite was
Windows.

## Why the local suite could never catch it

`CLAUDE.md` records `Platform: win32`. Every developer and every agent in this
repository has run the tests on Windows, where the win32 helpers are simply
correct. A constraint that only manifests on a platform nobody tests on is not
detectable by testing harder — it needs a *different environment*, which is
precisely what CI supplies and what this repository had never had.

This is the clearest possible argument for the CI that was added the same day:
its first execution surfaced a real architectural fact that three months of
green local runs could not.

## Fix

- **CI runs on `windows-latest`.** The alternative — making `local-files/`
  cross-platform — would rewrite security-sensitive containment code to satisfy
  an environment the feature does not target. Matching the runner to the
  documented platform is the honest fix; rewriting the security model to make a
  runner happy is not.
- **The constraint is now written down.** SDD-023's statement records that
  containment is Windows-path-based and that the managed local workspace is
  Windows-only, while the rest of the product remains portable. The id is
  unchanged — this is a clarification of an existing decision, not a new one.
- The `shell: bash` pin was added to the one workflow step that uses shell
  conditionals, since `windows-latest` defaults to PowerShell.

## What this does not settle

The product targets Supabase/Postgres for production (FR-030, ADR-018), and a
hosted deployment will not be Windows. That is consistent today — hosted mode
already disables local-capability operations (SEC-007's "OS reveal is
local-capability-only; hosted requests can never launch") — but the boundary
deserves a deliberate statement rather than an inference. If a Linux-hosted build
ever needs any part of `local-files/`, that is an ADR, not a patch.

## Prevention

- **A constraint that only one platform can violate is invisible on a
  single-platform team.** Write it down when you make it, because the code that
  encodes it reads as an implementation detail.
- **Pin CI to the platform the feature targets**, and say why in the workflow —
  otherwise the next person "fixes" the runner and rediscovers this from the
  other side.
- **A failing first CI run is a result, not a setback.** The instinct to make it
  green quickly is the instinct that would have deleted the finding.
