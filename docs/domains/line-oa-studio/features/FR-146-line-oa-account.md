---
domain: line-oa-studio
feature: FR-146
module: line-oa-studio
source: v2-native
bundle: FEAT-018
requirements:
  - FR-146
version: "0.1.0"
status: building
---

# FR-146 — `LineOaAccount`, the account aggregate

## Intent

One row per LINE Official Account a Business operates, many per Business, one
Business each. It is the root the rest of LINE OA Studio hangs off (rich menus,
flows, dispatches, jobs, insights), so the first Phase 1 slice builds it alone:
the model, the only writer, the collection and item routes, and the tests.

## Decisions worth recording

**The account is not the connection.** The integration lane's
`IntegrationConnection` (`LINE_OA`) is the credential and evidence identity;
the account is the operating identity. Connecting an account *selects* an
existing connection of the same Business (1:1, enforced by a unique column) and
never creates one, reads credential material or returns it. Creating a LINE_OA
connection stays with the integration lane's owner-only contract, which today
serves the Phase 1 model-provider purpose — the Studio's "connect" therefore
starts from a connection an operator already registered.

**`LIVE` is derived, never stored.** The stored status machine is DRAFT →
CONNECTED → PAUSED | ARCHIVED. An account reads LIVE only while the agent lane
reports an ACTIVE binding for it (FR-052). That read model lives in the
production Postgres runtime, not the shared Prisma schema. Slice 1 wired no
reader and said `UNKNOWN`; slice 2 (FR-147, same day) added the agent lane's
read-only contract and made it the default `bindingStatus` port. The contract
is narrow on purpose: the `zuri_line_smartgift_ro` policy shows only ACTIVE,
in-window rows, so the port reports ACTIVE / NOT_ACTIVE / NO_BINDING / UNKNOWN
and never a PENDING or INACTIVE it cannot see, and `health.sources.binding`
says which of the four applies and why. The policy is still pinned to the
SmartGift Tenant/Business; other Tenants read NOT_ACTIVE until an operator
migration widens it.

**Health is computed from three owners and stored nowhere.** Connection status,
secret readiness and the last webhook receipt come from the integration lane's
redacted read model (`readLineOaConnectionHealth`, added for this purpose);
binding state from the agent lane's port; transport jobs and quota are `null`
until their slices exist. Every field says where it came from.

**Transport mode from the edge credential, then only by audited switch.** At
connect time `transportMode` defaults to EDGE when the Business holds an ACTIVE
`EdgeDeviceCredential` (FR-144) and CLOUD otherwise — the ADR-059 D5 selection
rule — and a publisher may override it in the same request. Afterwards it moves
only through `SWITCH_TRANSPORT_MODE`, a compare-and-swap on `version` that
records from/to and the count of transport jobs cancelled under the old owner:
truthfully zero today, because the job lane is a later slice.

**Publisher authority is the FR-076 shape.** `LINE_OA_PUBLISHER` is a key in
identity's generic role registry with one permission, `line-oa.account.publish`;
a Business OWNER holds it implicitly. Viewing needs Business visibility plus the
`line-oa` domain (FR-061), which is why this slice adds the `line-oa` slot to
`src/config/domains.js` as a reserved (`soon`) entry: a Membership grant can only
name a key the registry knows, and a hidden slot renders nothing (ADR-060 D12).

**Refusals are one 404.** An unknown Business, a Business the viewer may not
see, a Business without the domain grant, and a non-publisher acting all answer
"Business not found" (FR-072); an unknown, foreign-tenant or non-LINE connection
answers "Integration connection not found".

## Out of this slice

The `/line-oa` pages, rich menus, the transport-job lane, the crm thread-key
prerequisite (ADR-060 D9), a per-Tenant binding read policy, and production
application of `supabase/migrations/20260905120000_line_oa_account.sql`.

## Proof

- `tests/unit/line-oa-account-domain.test.js` — status machine, derived LIVE, default mode, input contracts
- `tests/unit/line-oa-account-schema-contract.test.js` — both schemas, snapshot list, additive migrations
- `tests/unit/line-oa-account-routes.test.js` — routes, inventory, domain slot, role
- `tests/integration/fr146-line-oa-account.test.js` — real database: connect, defaults, uniqueness, authority ladder, versioned actions, audit without secrets, computed health
