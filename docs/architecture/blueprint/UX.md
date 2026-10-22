---
status: active
superseded_by: null
version: "1.0.0"
artifact_kind: resolved-source-projection
source_revision: "18008b774fc54febd23ca675d142f15da7d67db5"
---

# User experience

These journeys are target product behavior. They do not claim that a route or
interaction is implemented or live. The product keeps business work legible to
its users; developer tasks and delivery controls stay in their separate
engineering surfaces.

## Profile and scope onboarding

1. A new person completes their Profile without creating operational business
   data merely to enter the product.
2. They can create or join a shared top-level Workspace, or wait for an
   invitation, without that collaboration membership granting Tenant or
   Business authority.
3. A Business owner enters or creates Business context within its Tenant.
   The application may establish an Organization/Tenant implicitly, but it
   cannot attach a Business directly to a top-level Workspace or treat a Branch
   as a Tenant.
4. The product shows only the useful context selectors: Workspace (backed by
   schema `Portfolio`), Business and Project. The schema's `Workspace` is the
   product's Space grouping; it may be hidden from navigation, but every Project
   still has the required Business-scoped grouping in persisted data.
5. A member with no Business grant sees a safe waiting/empty state and invite
   instructions. They are not pushed into creating a false Business or Project.

Display product labels consistently with ADR-027. In the schema, `Portfolio`
backs the top-level collaboration Workspace and `Workspace` backs the Project
Manager Space. The interface should not display those schema names as though
they were the same product concept.

## Objective-first project creation

The user starts with the desired outcome and relevant context. Planning then
decomposes it into Workstreams, each with one of the seven canonical execution
modes. The application activates the matching focused view automatically while
retaining universal Overview, All Work, Timeline, Dependencies, Milestones &
Gates, Calendar and Table views. A mode override, if present, is an advanced
setting and does not become the primary project-creation picker.

The seven modes are `SOFTWARE_SPRINT`, `DATA_MIGRATION`, `B2B_SALES`,
`B2C_CAMPAIGN`, `PRODUCT_LAUNCH`, `OPERATIONS` and `BUSINESS_EXPANSION`.
Progress communicates the Workstream's strategy, weight and evidence. The UI
does not reduce all projects to a task-count percentage or recast a human
Business WorkItem as a developer ticket.

## Importing an external plan

1. The user selects a Business and Project scope they are authorized to change.
2. The product validates the source schema and shows a preview of proposed
   Workstreams, work, dependencies and changes.
3. It identifies invalid input, unsupported data, stale versions and conflicts
   before writing.
4. The user can compare the existing state with the proposed plan, correct the
   source, or cancel without changing business data.
5. Commit occurs only after authorization and conflict checks pass. The
   accepted plan is written transactionally and audited.

The preview treats imported content as data, never executable instructions.
The server remains the authority for scope, IDs and permissions.

## LINE OA Studio

The Studio helps an authorized Business user connect and manage LINE accounts,
design account content, stage dispatches, review quotas and receipts, and
understand health using sourced data. The account itself is a scoped resource;
switching an account does not widen the user's Tenant or Business authority.
Connection and transport use the approved server Integration boundary. The
screen never requests or redisplays a LINE channel secret after connection.

Conversation work is server/Core-owned and invokes the accepted versioned
Runtime contract. There is no Edge Device pairing, Edge extraction, device
credential, device job console or Edge runtime mode in the current user journey.
Historical stored records remain governed by ADR-110 and are not shown as a
currently connectable device.

Before a user publishes or sends, the UI shows the selected Business/account,
the actor's authority, the audience or content preview required by the relevant
contract, and the applicable consent, approval and confirmation gates. A LINE
provider acceptance receipt is described as acceptance, not as delivered or
read. A timeout with unknown external effect has an explicit unknown/reconcile
state; the user is not invited to blindly repeat a send.

## Knowledge and source browsing

The Knowledge Studio behavior selected by FR-289 is a separate, read-only
installation-operator experience. Operators can browse/search the indexed graph,
inspect exact source paths and read source text only where the generated graph,
repository files, path safety and operator authority permit it. Domain grouping
comes from explicit graph relations or document metadata; a folder name alone
does not establish ownership. The original graph component remains local to the
operator's browser loopback origin; Zuri does not host its bundle.

## Interaction and recovery states

Every important surface presents these states intentionally:

| State | User experience |
|---|---|
| Loading | Keep the current scope visible and indicate what data is being fetched. Do not show a stale selection as though it were current. |
| Empty | Explain why the view is empty and provide only an action the user's current authority permits. A missing Business is not fabricated to fill space. |
| Validation error | Point to the invalid field or source clause; retain the user's safe draft so they can correct it. |
| Denied or hidden | Stop before mutation and use the source-defined non-disclosing refusal. Do not reveal inaccessible records by title, count, autocomplete or different error wording. |
| Conflict | Show the changed/current values and the proposed values. Require the owning contract's resolution choice before a write. |
| External result unknown | Preserve the correlation/reference and show the state as unknown. Offer a status check or reconciliation action that follows the idempotency contract, not a duplicate send. |
| Retryable failure | Explain whether the operation is safe to retry under its idempotency key; never assume a network timeout means no external effect. |

The UI supports keyboard navigation, visible focus, semantic labels and
announced state changes. Text and color are not the only means of conveying
status. User-facing copy follows the Thai/English language contract for the
surface. Use the current Zuri Heritage design tokens and accessible behavior
preserved by NFR-008 and SDD-010. ADR-024 removes the obsolete V1-lift,
replacement and cutover tail from those historical clauses; it does not remove
their applicable UI token or accessibility commitments.

## Product state versus delivery state

Users see the states of their actual business objects: Projects, Workstreams,
imports, account connections, dispatches, conversations and receipts. Engineers
see task readiness, implementation plans, CI/test results and delivery gates in
separate delivery-control artifacts. A developer's plan status is not a
Business Project status, and a CI check is not a user's domain event.
