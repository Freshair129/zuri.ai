# Market Intelligence service core

Session 4 service-extraction package (M1). It holds the Market translation core,
the observation feed and the translation run behind explicit ports. It does not
import apps/server, Next.js, Prisma or another domain.

**It does not run anything yet.** `apps/server` still executes every Market request.
A separately running process (M2) waits on an ADR amending ADR-038 D8. See
[the handoff](../../docs/migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md).

```bash
npm ci        # installs zod only
npm test      # node --test, no DB and no Next
npm run build # boundary scan + syntax check
```

`contracts/v1/translation-vectors.json` is shared with
`apps/server/tests/unit/market-intelligence/service-core-parity.test.js`. Both copies
of the core must reproduce it. Regenerate it with `node scripts/write-vectors.mjs`
only when translation semantics change on purpose, and bump
`translationSchemaVersion` when you do.
