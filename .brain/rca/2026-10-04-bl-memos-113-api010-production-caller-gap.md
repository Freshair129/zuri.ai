# RCA — BL-MEMOS-113 API-010 production caller gap

**Date:** 2026-10-04  
**Risk:** C-3 / HIGH  
**Status:** Root cause confirmed; production implementation remains gated.

## Symptom

The LINE production composition does not call API-010 `msp_vault_resolve` before
API-009 episodic-memory access. The existing API-011 session/thread context path
can be mistaken for that integration even though it uses a separate contract.

## Evidence

- `apps/server/src/modules/agent/runtime.js` composes API-010 and API-009 ports
  in `createAgentPorts()`; a source call-site search found no production caller.
- `apps/server/src/modules/line-oa-studio/application/server-line-runtime.js`
  composes `createMspThreadMemoryPort()` for LINE.
- `apps/server/src/modules/line-oa-studio/application/conversation-runtime-memory.js`
  obtains thread context through API-011 `msp_thread_*` operations.
- FR-057's exit gate requires API-010 on every private-memory turn. ADR-091 and
  FR-231 define the API-011 session/thread path separately and retain policy,
  consent, receipts and erasure gates.
- At the baseline revision, LINE admission used only the deployment-level
  `ZURI_MSP_THREAD_MEMORY_ENABLED` flag and `LineOaAccount` had no `memoryPolicy`.
  The current candidate adds an OFF-by-default account policy snapshot and uses
  the environment flag as a runtime kill switch for API-011 session operations.
- The candidate also gates the API-010 resolver/API-009 memory port on a distinct
  episodic authorization decision. This is fail-closed defense in depth; no
  production LINE caller or episodic retrieval has been added.
- `memoryServerScope()` in `apps/server/src/modules/agent/server-line-answer.js`
  provides tenant, business, channel and agent but no workspace or project.
  `resolveAgentAuthorization()` leaves those scope fields null unless trusted
  server scope supplies them; its fallback workspace value exists only on the
  compatibility vault object and does not populate `AuthContext.scope`.
- The pinned signed API-010 candidate requires non-empty `workspace_id` and
  `project_id` in `access_context`, and both values are signed grant claims.
  There is no trusted LineOaAccount/business mapping in the current model.
- MSP main at `4928e71d42687b4eb72de060091d031ea22b5b91` does not require the
  signed API-010 `legacy_access` grant. That contract change exists on the local
  MSP feature branch at `fd6c24b0d6d6f2e51b67cd39c775d962057eba0c` only.

## Root Cause

The API-010 resolver and API-009 memory port were composed as a reusable agent
port, but never connected to the LINE production composition. The production
session-memory feature was implemented separately through API-011. Treating that
session path as the API-010 caller would cross the session and episodic-memory
authorization boundaries. Separately, the LINE server scope does not provide
the required workspace/project owner tuple, so wiring the adapter without a
trusted mapping would require inventing authorization scope.

## Why the issue escaped detection

Adapter tests call `createAgentPorts()` directly and verify its ports in
isolation. LINE composition tests cover API-011 but do not assert an API-010 call
before API-009 private retrieval. The existing work-plan exit gate was not proven
against the production composition. In addition, the signed API-010 contract is
not yet on MSP main, and FR-231's account policy/erasure prerequisites are not
complete in the current source.

## Proposed prevention

1. Keep API-011 session context and API-010 → API-009 episodic memory as separate
   production ports with separate authorization and erasure gates.
2. Add a production-composition test that proves API-010 authorization precedes
   every API-009 private-memory read/write and that denial produces no API-009 call.
3. Require trusted per-turn owner, policy, consent and audience data; missing or
   untrusted values deny private memory.
4. Do not activate the caller until the signed API-010 contract is on MSP main,
   the FR-231 policy/receipt/erasure gates are met, and rollback/deployment
   acceptance is recorded.
5. Obtain an approved server-owned LINE-to-workspace/project mapping before
   constructing the API-010 request; missing scope must stop before transport.

## Version diff

0.0 → 1.0: records the confirmed missing production caller, the API-011/API-010
boundary, the MSP contract mismatch, and the required prevention gates.
1.0 → 1.1: adds the independently verified missing workspace/project mapping
required by the signed API-010 candidate. No code or production state was changed
by this RCA.
1.1 → 1.2: records the account-policy/runtime-kill-switch hardening and makes
clear that the absent production API-010 caller and trusted mapping remain open.
No production state was changed by this RCA.
