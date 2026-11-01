---
id: ZAI:PLAN-PRIVATE-RUNTIME-INTEGRATION
status: active
version: "0.1.0"
attributes:
  doc_type: implementation-plan
  domain: integration
relations:
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-106
---

# Private Runtime integration implementation plan

**Goal:** Harden the existing FR-267 provider path and provide opt-in secure Docker connectivity without rebuilding the external PRP.

**Spec:** Owner's six-phase Private Runtime integration task, 2026-10-31;
[FR-267](../features/FEAT-045/requirements/FR-267.md),
[ADR-100 D7](../decisions/ADR-100-LINE-OA-RUNS-SERVER-EXECUTED-ON-BROWSER-PROVISIONED-API-KEYS.md),
[ADR-106](../decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md).

**Architecture:** Keep Core's Business-scoped vault resolution and authoritative jobs. Both executors use the configured PRP origin, Bearer key and exact alias. Docker clients reach a dedicated HTTPS proxy at one fixed internal IP with an IP SAN certificate and a read-only private CA bundle; the proxy publishes only the two PRP client operations. No service-name HTTP exception, TLS bypass, redirect or external-provider fallback.

**Tech stack:** Existing Next.js/Node 22, independent dependency-free Node Runtime, Docker Compose and an nginx TLS boundary. External PRP retains LiteLLM/vLLM and state ownership.

## Audit and root cause

Baseline: `848e422e32439edae63d9657fcfa2b976c9f8ea4`.
Server already implements FR-266 credential lifecycle and FR-267 model-list validation, alias selection, completion calls and reasoning filtering. Core resolves Runtime credentials from claim-bound tenant/Business state. Runtime's model adapter accepts arbitrary HTTP despite Server's HTTPS/loopback rule. Neither adapter validates a directly supplied PRP URL consistently. The admin probe clears its deadline before reading the model list, and checks size after reading the whole body. Runtime misses an already-aborted signal; Server does not connect caller cancellation/deadlines to its fetch. Existing tests mostly replace fetch and therefore do not verify real TLS or redirects.

External inspection: `E:/prp`, HEAD `12f0aab` (read-only; unrelated untracked evidence preserved). Its `contracts/openapi/prp-client.yaml` defines the expected operations and rejects unknown request properties. Its control-api README and source describe fail-closed missing adapters; its WP24 LiteLLM configuration is explicitly NOT_QUALIFIED. No running PRP/LiteLLM/vLLM container was found. This is an external acceptance blocker, not authority to implement PRP here.

## Constraints and decisions

- No production, Supabase writes, real key rotation, public LINE calls, queue/cohort activation or external-repository changes.
- No canonical identity/statement/membership changes. Existing approval and delivery states remain intact.
- Use existing primary checkout on a dedicated branch; preserve prior work and runtime containers.
- Risk: HIGH for credential transport; mitigate through exact-origin checking, verified TLS, bounded bodies/deadlines and negative socket-level tests.
- ADR-058 currently deploys the combined Next.js app. A Vercel-only frontend split is a proposed amendment requiring auth/origin/CSRF/CORS and release qualification, not an implemented deployment claim.
- GenesisBlockDB stays in the existing separately qualified knowledge deployment and persistent volumes. Do not invent a new database API or duplicate PostgreSQL for Supabase.

## Implementation and checks

1. Add failing URL parity/metadata, probe-body timeout/size, cancellation and no-fallback regressions in existing Server and Runtime provider tests. Run each affected test before implementing the corresponding fix.
2. Harden `private-runtime-config.js`, `model-provider-admin-port.js`, `model-provider.js` and Runtime `model-port.js`; keep private model configuration dependency-free and verify equivalent URL decisions. Runtime additionally pins the Core-supplied URL to its own operator configuration.
3. Add opt-in `docker-compose.private-runtime.yml` plus `deploy/private-runtime/` TLS configuration. Attach existing web/Runtime to a dedicated internal network and an HTTPS-only proxy; use an external PRP network for the upstream. Preserve existing knowledge/Supabase deployment. Provide a disposable GPU-free HTTPS fixture profile and tests; no external credentials.
4. Run real socket-level TLS, redirect and completion tests; existing Business credential/isolation and Core contract regressions; Runtime tests/build; Server build/lint and governance. Validate Compose without reading protected env contents. Exercise disposable containers only, and retain actual failures.
5. Update deployment operations with topology, variables, TLS setup, external LiteLLM/vLLM requirements, readiness, restart/storage checks, troubleshooting and rollback. Obtain independent review of the same final patch, resolve findings and record exact evidence.

## Review focus

- Invalid TLS/redirects must fail before any second origin receives a key.
- Slow or oversized response bodies must remain bounded after headers arrive.
- Cancellation before dispatch must issue no inference request; cancellation after dispatch cannot prove GPU compute stopped.
- A missing/revoked PRP key or alias must never choose a public provider.
- Fixture, source wiring, Docker readiness and real PRP/GPU/production receipts remain distinct.

## Acceptance evidence

Implementation and local evidence are recorded in the
[verification report](../../reports/private-runtime-integration-20261031.md).
Independent review corrected response-body cleanup, public test-key admission,
upstream virtual-host routing and the exact method allowlist. The final composed
checks and their limits are recorded there. Actual PRP request-path acceptance
remains **NOT_VERIFIED** until a qualified external endpoint, scoped test keys and
local model are available. A successful fixture is not completion of the owner's
full acceptance criteria.
