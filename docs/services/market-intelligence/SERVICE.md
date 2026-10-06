---
id: ZAI:SERVICE-MARKET-INTELLIGENCE
status: active
superseded_by: null
version: "0.1.0"
relations:
  - type: relates_to
    target: ZAI:ADR-108
---

# Market Intelligence service boundary

[ADR-108](../../decisions/ADR-108-MARKET-INTELLIGENCE-SERVICE-EXTRACTION.md)
defines the independent process and MarketObservation writer boundary. The
[domain charter](../../domains/market-intelligence/CHARTER.md) remains the logical
owner. Core owns the authority, raw-evidence and audit façades specified by that
decision; a caller's service credential does not replace business scope.

The [package](../../../services/market-intelligence/package.json) has independent
dependencies, tests and build. Its contracts/conformance vectors live in the
service's existing folders. Use the
[handoff](../../migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md) as
dated migration evidence, not as an automatic current deployment claim.

Marketing reporting inside Core is a separate concern; the MI service folder does
not extract the entire Marketing domain. Production cohort routing, restricted DB
roles and live integration require their own receipts. This increment changes none.

See [TESTING](TESTING.md). MI remains outside the Runtime shadow pilot and retains
the current CI service job and conservative selection policy.

Version diff 0.0 → 0.1.0: adds the service entry point with existing authority.
