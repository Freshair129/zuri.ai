---
status: active
superseded_by: null
version: "0.1.0"
---

# Conversation Runtime verification

Run the `test` and `build` scripts from the
[package](../../../services/conversation-runtime/package.json). Service tests use
Node's test runner and bounded fake ports. The build checks source syntax and
forbidden dependencies. These checks do not require Next.js or a live model/LINE
provider and do not establish production routing.

Core consumer/port tests also matter. The existing
[scope selector](../../../scripts/ci-change-scope.mjs) discovers Server test files
referencing `services/conversation-runtime/`; the shadow pilot preserves that set
and rejects an empty/missing set. A changed operation schema, authority rule or
Core adapter needs the relevant producer and consumer checks. Text discovery is
current evidence, not proof that every remote consumer has been inventoried.

Example: changing `src/context.js` selects Runtime test/build and discovered Core
contract tests. Adding this page to the same change leaves that candidate scope
intact, but changing a charter, policy, package, runner or metadata does not get
that exemption. A source deletion/rename falls back conservatively.

`npm run verification:plan -- --base <commit> --event local` prints the same shadow
planning logic used by CI and includes local WIP. It executes no tests and cannot
skip CI jobs. Read the [policy](../../architecture/VERIFICATION-POLICY.md) before
interpreting a plan as acceptance. Current CI still exercises the existing jobs.

Keep SQLite/PostgreSQL fixtures and ports in each worktree/job. The Core-side
WorkToolPort PostgreSQL suite and image/drain checks retain their existing CI
requirements; Node-only service tests are not substitutes for them. Record exact
revision, engine, runner, counts and PASS/FAIL/NOT_RUN with any receipt.

Version diff 0.0 → 0.1.0: adds reproducible scope guidance and the shadow-only limit.
