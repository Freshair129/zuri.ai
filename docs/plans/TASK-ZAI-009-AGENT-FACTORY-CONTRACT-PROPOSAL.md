---
doc_type: task-contract-proposal
task_id: TASK-ZAI-009
status: candidate
source_of_truth: false
version: "0.1.0"
based_on: "73c104ed6834089b580e49b2647eca35bc67f91b"
updated: "2026-10-15"
---

# TASK-ZAI-009: Agent Factory contract proposal

> Candidate design for later disposition. This document is not an approved
> factory contract, requirement, ADR, or implementation instruction.

This proposal describes a possible local contract for applying the existing
core agent roles to a Business. It separates what the pinned source currently
does from choices that still need an owner disposition. A later approved
contract and a separately admitted implementation task would be required before
application behavior changes.

## 1. Current-code audit

### Roadmap state and authority

At the source revision above, the [canonical delivery ledger](../roadmap/ROADMAP.md#canonical-delivery-ledger)
records TASK-ZAI-009 as `planned / UNKNOWN / NOT_STARTED`, dependent on
TASK-ZAI-007. Its evidence says there is no approved Agent Factory contract and
no implementation or test evidence. The row is the delivery-status authority.

The [24-week Task Container](../roadmap/ROADMAP-zuri-ai-24w-program.md#tc-task-zai-009)
is a derived compatibility projection. It lists three unchecked ideas: apply a
template to a new Business and create five roles without manual wiring; refuse
a dynamic sub-agent request that policy does not permit; and make repeated
application idempotent. These are useful acceptance questions, but they are not
an approved contract. The matching runtime projection in
[`program-roadmap-containers.js`](../../apps/server/src/modules/platform-control/program-roadmap-containers.js)
also carries those criteria as unchecked.

### Role registry

[`role-registry.js`](../../apps/server/src/modules/agent/role-registry.js)
defines five frozen role specifications: `EXECUTIVE`, `OPERATIONS`,
`FINANCE_ANALYST`, `RESEARCH`, and `MARKETING`. Each specification contains an
allowed tool-name list and policy fields for approval tier, scope access,
memory namespace, directive issuance, and maximum autonomous action
sensitivity. `resolveRoleContext` derives the role context and binds only the
standard tool descriptors allowed by that role. The scoped registry rejects an
unknown role and rejects an unlisted tool at registration time.

The pinned [role-registry unit test](../../apps/server/tests/unit/agent-role-registry.test.js)
asserts the five roles, distinct tool sets and policy namespaces, bind-time
refusal, and cross-role tool leak cases. It is source evidence for existing
test intent; no test was run for this proposal.

The pinned [Prisma schema](../../apps/server/prisma/schema.prisma) and
[seed](../../apps/server/prisma/seed.js) do not define an `AgentFactory`,
`AgentRole`, or `AgentConfig` model or seed identifier. They therefore do not
specify a durable factory record, application lifecycle, or existing-Business
backfill.
The inspected [`turn.js`](../../apps/server/src/modules/agent/turn.js) action
path calls `executeAgentAction` with the write registry; the role registry is
not a substitute for that action boundary.

### Role memory

[`role-memory-partition.js`](../../apps/server/src/modules/agent/role-memory-partition.js)
builds private keys from tenant, Business, role, and principal IDs, and shared
keys from tenant, Business, and topic. The port requires a known role and both
tenant and Business IDs. A cross-role private read returns no entries and emits
a denial audit record through the optional callback and/or database client.

The pinned [partition unit test](../../apps/server/tests/unit/role-memory-partition.test.js)
covers private role separation, shared Business memory, denied-and-audited
cross-role reads, unknown roles, and distinct tenant/Business keys. Its memory
adapter is in-memory; the database audit check uses a mock. These tests do not
establish a durable factory lifecycle or deployed tenant isolation.

[`ADR-023`](../decisions/ADR-023-AGENT-VAULT-AND-EPISTEMIC-MEMORY.md) is marked
Proposed, awaiting owner sign-off. Its private/shared-vault discussion is
relevant context, not an approved Agent Factory contract. [`ADR-033`](../decisions/ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md)
is marked Candidate. It keeps platform, tenant, Business, and product authority
separate and says authorization must use server-resolved identity and persisted
authority, not client-supplied tenant IDs, Business IDs, or role labels. Neither
ADR establishes factory lifecycle or policy upgrade behavior.

### Separate write/action authorization

[`FR-026`](../requirements/FR-026.md) defines Gate F: write tools are held in a
separate registry with `effect WRITE` and an executor; `authorizeAgentAction`
checks Membership RBAC, resource ownership, and sensitivity; HIGH-sensitivity
actions require a single-use step-up token; and `executeAgentAction` resolves
the principal, authorizes, enforces step-up, executes the write in one
transaction, and appends an audit event. Read remains Gate E. The inspected
[`turn.js`](../../apps/server/src/modules/agent/turn.js) action path uses
`executeAgentAction`.

Any factory contract must preserve Gate F as a separate authorization boundary.
A role assignment, tool allowlist, memory policy, template application, or
sub-agent relationship must not itself authorize a write or bypass step-up,
resource ownership, transaction, or audit requirements.

## 2. Candidate contract

The following is a proposed contract outline, not a schema ready for use. The
names and behaviors remain subject to the decisions in section 3.

| Contract area | Candidate statement | Current authority boundary |
|---|---|---|
| Identity and version | Identify a factory contract and template with explicit versions so a later apply can name the source definition it used. | Version format, compatibility, and upgrade rules are open. |
| Business scope | Identify the Tenant and Business target from trusted server context for each application. | A client-provided ID or role label must not establish authority; see ADR-033 D2/D5. How a role's declared scope relates to this target is unresolved; see section 3. |
| Core roles | Reference the five existing role IDs and their specifications rather than silently creating new role identities. | Whether all five are mandatory defaults for every Business remains to be decided. |
| Tools and policy | Use the role registry as an input when deriving the initial allowed tool names and policy values. Reject an unknown role or a tool outside its role allowlist before binding. | Registry metadata is not by itself an effective cross-Business grant. The relationship between `scopeAccess`, directive authority, and the application target remains open; see section 3. Tool binding does not grant permission to execute a write. |
| Memory | Declare whether each role uses its private partition and which Business-shared topics it may use, preserving tenant/Business partition keys. | Persistence, retention, and application lifecycle are open; ADR-023 is proposed. |
| Dynamic sub-agents | Represent delegation as an explicit policy instead of an implicit fallback. Candidate recommendation: deny creation when no applicable policy is present. | Permitted roles, scope inheritance, depth, limits, and audit are open. The deny recommendation is not approved behavior. |
| Writes | Reference the FR-026 Gate F contract for any write-capable tool. | The factory may describe a tool binding; only the independent action gate authorizes and executes writes. |
| Application outcome | Define a deterministic preview/apply result and a stable way to identify the target Business and template revision. | Persistence, conflict handling, idempotency key, transaction, and rollback behavior are open. |

An eventual serialized form should make these boundaries explicit. This outline
does not define field names, storage, APIs, or a migration:

```yaml
factoryContractVersion: <required version>
templateId: <stable template identity>
templateVersion: <template revision>
scope: <trusted Tenant and Business context>
roles:
  - roleId: <existing CORE_AGENT_ROLES member>
    specification: <existing ROLE_SPECIFICATIONS entry>
    memoryPolicy: <explicit private/shared partition policy>
subAgentPolicy: <explicit policy; unresolved>
writeAuthorization: <separate FR-026 Gate F reference>
```

## 3. Decisions required before adoption

These decisions remain open. This proposal does not resolve them on behalf of
the owner or turn adjacent candidate documents into approval.

1. **Persistence and application lifecycle:** decide whether a factory is a
   pure resolver, a persisted Business configuration, or both; when it is
   applied; which service owns preview and apply; and what transaction boundary
   covers the operation.
2. **Policy versioning and upgrades:** decide whether applied Businesses pin a
   template snapshot or follow a live role specification; define compatible
   upgrades, drift detection, rollback, and how removed or changed tools are
   handled.
3. **Existing Business backfill:** decide whether existing Businesses are
   untouched, explicitly opted in, or covered by a reviewed backfill. Specify
   scope checks, preview, audit, and rollback before any backfill is considered.
4. **Idempotence, conflicts, and rollback:** define the stable application
   identity, the expected result of applying the same revision twice, how local
   customization conflicts are detected, whether partial application is
   possible, and what rollback can safely restore.
5. **Dynamic sub-agent scope:** define who may request a child agent, allowed
   child roles, scope inheritance, depth/count limits, tool and memory
   inheritance, denial behavior, and audit. Decide whether the candidate
   default-deny recommendation is adopted.
6. **Audit and tenant-boundary evidence:** define lifecycle and denial events,
   required audit fields, failure handling, and tests that prove separation
   across roles, Businesses, and Tenants using the selected persistence path.
   Current in-memory unit tests alone cannot prove a durable isolation boundary.
7. **Effective role scope and role defaults:** define how each registry
   role's `scopeAccess` value, including `ENTERPRISE_WIDE`, relates to the
   trusted Tenant and Business target. Decide whether registry scope is a
   ceiling, is intersected with the selected Business, or can extend to
   multiple Businesses only through a separate persisted grant. Define the
   effective scope of directive issuance as well; a registry value alone
   must not silently establish cross-Business authority. Also decide whether
   the five registry roles are mandatory defaults or a selectable starting
   set, and determine which parts of ADR-023 and ADR-033 are approved
   constraints for this contract. Their current Proposed/Candidate lifecycle
   must be reconciled before claiming approval.
8. **Factory administration authority:** identify which server-resolved actor
   capability authorizes preview, initial apply, reapply, upgrade, rollback,
   and any existing-Business backfill. Define how that capability is checked
   against persisted authority, which operations need distinct permissions,
   and the required denial and audit behavior. A caller-supplied identity,
   Tenant ID, Business ID, or role label must not authorize factory
   administration.

## 4. Non-goals and safeguards

- This draft grants no implementation authority and does not approve or adopt
  any proposed factory behavior.
- No implementation authority is granted by this proposal.
- No code, migration, seed, requirement or runtime changes are authorized by this document.
- It does not change TASK-ZAI-009 or any other task status, issue an ID, or
  change a requirement, ADR, registry, or roadmap row.
- It does not add code, tests, schema, migrations, seeds, persistence, a
  provisioning flow, or Business backfill.
- It does not change the five core role specifications, dynamic sub-agent
  behavior, memory retention, or policy values.
- It does not weaken or replace FR-026 Gate F, Membership authorization,
  resource-ownership checks, step-up, transactional writes, or append-only
  action audit.
- It does not grant Tenant, Business, provider, production, Supabase, or
  credential authority.
- The old 24-week Task Container remains a compatibility projection and is not
  elevated into the contract's source of truth.

## 5. Proposed future acceptance criteria

The following Given/When/Then criteria are proposals for a later reviewed
contract and implementation task. They are not current requirements or test
results. The accepted decisions in section 3 must first fix the expected
lifecycle and conflict semantics.

1. **Validate a versioned template.** Given a contract with required identity
   and version fields and only known role references, when the contract is
   validated, then it produces a deterministic normalized plan; an unknown
   role, malformed version, duplicate role, or unrecognized tool fails before
   any apply effect.
2. **Apply the standard role set.** Given an eligible Business and an approved
   template that selects all five current core roles, when the approved apply
   operation completes, then each role resolves to the registry's declared
   tools and policy without manual role wiring, no role receives an unlisted
   tool, and effective scope follows the accepted scope rule without implicit
   cross-Business authority. If the owner chooses a selectable set instead,
   the accepted contract must define the exact default and its oracle.
3. **Refuse disallowed dynamic delegation.** Given a request for a sub-agent
   that is absent from or denied by the applicable explicit policy, when the
   request is evaluated, then creation is refused before persistent side
   effects and is not silently downgraded to a different role. Allowed
   delegation must remain within the accepted effective Tenant and Business
   scope.
4. **Keep memory partitions separate.** Given two roles in one Business,
   different Businesses in one Tenant, and different Tenants, when each reads
   private and permitted shared memory through the selected storage adapter,
   then private reads remain role/principal scoped, shared reads remain within
   the intended Business, and denied cross-partition reads return no private
   entries and produce the specified audit evidence.
5. **Keep writes behind Gate F.** Given a template with a write-capable tool,
   when a principal lacks Membership authorization, resource ownership, or a
   required HIGH-sensitivity step-up token, then the action is denied without
   the write. Given valid authorization, then the write uses the FR-026
   transaction and append-only audit path. Role membership or template
   application alone never authorizes it.
6. **Prove idempotence and conflict behavior.** Given the same approved
   template revision and target applied twice, when the second apply is
   attempted, then it creates no duplicate roles or unintended state change.
   Given a conflicting local customization or a failure partway through apply,
   then the operation follows the approved conflict/rollback rule and leaves
   no unaccounted partial state.
7. **Prove lifecycle and tenant boundaries.** Given the chosen persistence and
   upgrade model, when create, reapply, upgrade, denial, and rollback paths run,
   then audit records identify the scoped actor, Tenant, Business, template
   revision, and outcome, and tests demonstrate no cross-Tenant authority or
   memory access and no cross-Business authority or memory access beyond the
   effective scope selected by decision 7. If the accepted model allows a
   multi-Business scope, a separately persisted grant must define that scope
   and tests must deny access to Businesses outside it. Each lifecycle
   mutation and backfill must require the accepted server-resolved
   factory-administration capability; an unauthorized actor is denied before
   side effects with the accepted audit evidence.

## 6. Version diff

**0.0.0 → 0.1.0 candidate:** records the current role-registry, memory-partition,
FR-026, ADR, and roadmap evidence; proposes a versioned factory contract outline
and future acceptance criteria; lists the decisions needed before adoption.
This is a documentation proposal only. It issues no contract or requirement,
grants no implementation authority, and changes no task status.

## 7. Parent and peer impact

- **TASK-ZAI-007 / role registry:** remains the upstream source for the five
  current role identities, tool allowlists, and policy values. This proposal
  does not alter them.
- **TASK-ZAI-008 / role memory:** remains the current role-partition behavior
  and test reference. Persistence and factory lifecycle remain open.
- **FR-026 / TASK-ZAI-010:** the write/action gate remains independently
  authoritative for writes. This proposal does not decide or implement the
  separate L1–L4 approval semantics recorded as missing on TASK-ZAI-010.
- **ADR-023 and ADR-033:** their Proposed/Candidate status must be respected
  until separately dispositioned; citations here do not approve them.
- **TASK-ZAI-013:** its standard Business template and provisioning path remains
  downstream of TASK-ZAI-009; this proposal does not advance it.

## 8. Evidence and handoff

The source audit is against base `73c104ed6834089b580e49b2647eca35bc67f91b`.
The G0-pinned read-set hashes matched at authoring time. Source paths are linked
in section 1. Existing test files are cited as source evidence only; no
application tests, builds, generators, or runtime checks were run for this
documentation proposal.

Next, an independent verifier should check the proposal's source claims,
candidate-only lifecycle, single-path diff, and FR-026 boundary. A separate
reviewer should assess the contract outline and open decisions. Sol must resolve
any in-scope technical disposition and integrate only after the required gates.
