# Market Intelligence service

Session 4 service extraction ([ADR-108](../../docs/decisions/ADR-108-MARKET-INTELLIGENCE-SERVICE-EXTRACTION.md)).
It is a standalone Node process that owns Market translation and `MarketObservation`
writes. Authority, raw evidence and audit come from core's private façade.

**Nothing routes to it yet.** `apps/server` still executes every Market request. Core's
`/api/internal/market-intelligence/v1/*` façade and the `MARKET_EXECUTOR` flag are M3.
See [the handoff](../../docs/migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md).

```bash
npm ci
npm test          # node --test: core, both stores (Postgres reported NOT_RUN), HTTP API vs a fake core
npm run test:pg   # Postgres conformance in a disposable container (needs Docker)
npm run build     # boundary scan + syntax check
```

Local image-start rehearsal, as a separate Compose project that never touches `zuri-ai`:

```bash
docker compose -f services/market-intelligence/compose.rehearsal.yml up -d --build --wait
docker compose -f services/market-intelligence/compose.rehearsal.yml down
```

Configuration lives in `.env.example` (names only). Production refuses sqlite, schema
creation and assumed execution ownership.

`contracts/v1/translation-vectors.json` is shared with
`apps/server/tests/unit/market-intelligence/service-core-parity.test.js`. Both copies
of the core must reproduce it. Regenerate it with `node scripts/write-vectors.mjs`
only when translation semantics change on purpose, and bump
`translationSchemaVersion` when you do.
