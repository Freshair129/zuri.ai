---
status: active
superseded_by: null
version: "0.1.0"
---

# SCM verification

Use the [package scripts](../../../services/scm/package.json) for `kernel:check`,
`build`, `test`, `test:postgres` and diagnostic `test:pricing`. The full service
suites exercise their configured SQLite/PostgreSQL stores separately. Engine and
platform skips remain explicit; a narrow pricing PASS does not qualify receipts,
reservations or the whole service.

Changing Server pricing rules reaches the generated SCM kernel even when no
service file was hand-edited. Run generation through its owner command, inspect
the generated diff, then verify drift/parity and affected pricing/consumer tests.
The [kernel test](../../../services/scm/test/unit/kernel-sync.test.js) checks that
the mirror equals the generator output.

PO/receipt/stock changes require component, cross-module workflow and recovery
checks for atomicity, idempotency and concurrency, including the appropriate
database engine. Contract changes require provider and Core/other consumer
checks, not just a schema parsing test. Fake-Core service tests do not establish
live identity/reference/file authority.

SCM's current job remains enabled. Its generator and transaction edges must be
modeled before enabling scoped omissions under the
[verification policy](../../architecture/VERIFICATION-POLICY.md). No independent
Stock, Pricing or PO service is created by this work.

Version diff 0.0 → 0.1.0: records the real multi-domain and generated-input test scope.
