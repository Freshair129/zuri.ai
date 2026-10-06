---
status: active
superseded_by: null
version: "0.1.0"
---

# Market Intelligence verification

The [package](../../../services/market-intelligence/package.json) defines `test`,
`build` and `test:pg`. Node tests cover the service rules/HTTP/port behavior and
fixtures; PostgreSQL conformance provides separate store evidence. A fake Core
response is not proof that the live authority façade is wired correctly.

For a changed service rule run its service tests/build and affected Core consumer
checks. For changed store semantics retain PostgreSQL conformance, translation
vectors and compatible reads. For an authority/contract change include the Core
producer and all known consumers. Record environment, revision, test counts and
engine-specific omissions separately.

The current governance workflow already runs MI as its own job. The
[Runtime pilot](../../architecture/VERIFICATION-POLICY.md) only reports a candidate
omission when the diff is confined to another proven scope; it cannot skip MI now.
No task-result cache, new deployment, real data migration or live provider call is
part of this documentation change.

Version diff 0.0 → 0.1.0: describes reproducible service/store and consumer checks.
