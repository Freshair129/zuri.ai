# Market Intelligence module lane

This directory reserves the technical ownership lane `TD-MARKET-INTELLIGENCE` accepted by ADR-038.

There is intentionally **no runtime implementation in Phase 0**.

Before adding JavaScript, routes, Prisma models or runtime navigation, the implementing slice must:

1. reserve global requirement IDs in `docs/PRD-SDD-v1.0.md`;
2. update `docs/domains/market-intelligence/CHARTER.md` ownership claims for any new models/routes;
3. add `@req` / `@spec` / `@tested` annotations required by AGENTS.md;
4. run `npm run verify` and commit generated governance outputs rather than editing them by hand.

Boundary summary:

```text
Integration.RawExternalRecord
        ↓
Market translation
        ↓
MarketObservation / intelligence
        ↓
Consumers (Commerce, Marketing, Business Home, Agent)
```

Integration owns raw acquisition and credentials. Knowledge/GKS owns canonical product/category knowledge. Commerce owns operational products, inventory, approved vendors and procurement execution.

See:

- `docs/decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md`
- `docs/domains/market-intelligence/SRS.md`
- `docs/domains/market-intelligence/CHARTER.md`
- `docs/domains/market-intelligence/CONTEXT-MAP.md`
- GitHub issue #74
