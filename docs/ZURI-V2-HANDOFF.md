# Zuri v2 Handoff Checklist

After standalone MVP stabilizes, do not immediately merge.

Run a separate impact phase:

1. compare `Portfolio/Tenant/Business/Workspace` with current Zuri Tenant model
2. map Employee membership and authorization
3. map Customer / Conversation / Order ownership
4. decide whether Workspace is global or Project-only
5. decide database migration strategy
6. decide route/module placement
7. add Project module to Zuri `modules.js` only after architecture decision
8. update sitemap/routes after module decision
9. preserve Zuri Heritage design tokens
10. run cross-module tenancy tests

Recommended branch:

```text
decision A:
zuri v1 + project module

decision B:
zuri-v2
```

Do not call it a refactor if global identity/scope semantics change.
Treat that as a versioned architecture migration.
