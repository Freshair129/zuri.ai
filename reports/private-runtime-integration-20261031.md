---
doc_type: implementation-verification-record
status: partial-external-acceptance-blocked
version: "0.1.2"
source_revision: "5f73c1d88db7c338ae41f7d94776acfe015e0e4d"
validated_candidate_revision: "f781fb051907ac1d04dc416697870402e88a2869"
pull_request: "https://github.com/Freshair129/zuri.ai/pull/776"
---

# Private Runtime integration: implementation and verification

The Zuri-owned client hardening and opt-in Docker TLS integration are committed
on `codex/prp-integration-20261101` in PR #776, based on the refreshed `main`
revision above. The local implementation checks and code review below ran
against candidate `f781fb051907ac1d04dc416697870402e88a2869`; this report-only
provenance correction is a later PR commit.
**The overall task is not accepted as complete:** no actual PRP → LiteLLM → vLLM
request path has been verified. This report issues no requirements, deployment
authority, canonical lifecycle changes or product-completion claim.

Read the [plan](../docs/plans/PRIVATE-RUNTIME-INTEGRATION-20261031.md) and
[deployment guide](../docs/deployment/private-runtime.md) for architecture,
configuration, external ownership, rollout and rollback.

## Root cause and audit

Rejecting `http://litellm:4000` was intentional credential protection. The missing
piece was a deployable verified transport, not an HTTP allowlist exception.
Server already had Business credential lifecycle, granted-alias validation,
OpenAI-compatible completion and reasoning removal. Core already resolved
Runtime credentials from claim-bound tenant/Business state, with fail-closed
selection on a present-but-broken PRP connection.

The extracted Runtime accepted arbitrary HTTP and lacked its own operator-origin
pin. Direct Server/admin port calls did not repeat the configuration URL guard.
The admin timeout ended after response headers and bounded a model list only
after its complete read. Server's adapter lacked caller cancellation/deadlines,
and the Server answer chain did not forward the claimed job expiry to it.
Runtime missed pre-aborted cancellation and did not bound response bytes.

External PRP was found at `E:/prp`, HEAD `12f0aab`. Its source, client contract,
README and WP24 LiteLLM templates were inspected read-only. Its adapters are empty
and control-plane operations fail closed; its LiteLLM template is NOT_QUALIFIED.
No PRP, LiteLLM or vLLM container was found; no authorized native endpoint was
verified. Existing untracked PRP evidence
was preserved. A host RTX 3060 with 12 GiB VRAM was observed; that is not a
qualified vLLM deployment, model artifact or GPU acceptance result.

## Implemented changes and security impact

- Preserve HTTPS/loopback HTTP validation and refuse metadata/non-destination
  literals, including normalized and mapped IPv4 spellings. Add Server/Runtime
  parity checks. Require Runtime's independently configured origin to match Core.
- Bound model-list streaming to 256 KiB and PRP completion bodies to 1 MiB.
  Keep deadlines active through body reads. Cancel unread error bodies and strip
  secret-bearing provider failures to fixed codes. Never use reasoning-only text.
- Handle already-aborted and in-flight requests without fallback to another
  provider. Forward Server job expiry and explicitly supplied caller signals
  through the grounded-answer chain. Preserve normal evidence fallback policy;
  explicit cancellation/expired calls cannot become customer fallback replies.
- Add a fixed-IP HTTPS proxy on a private Docker network, with independent TLS
  verification to the external PRP. Only the two client operations cross it.
  Couple upstream HTTP Host to the verified TLS identity; reject HEAD and other
  methods, admin paths and queries. Publish no inference ports.
- Add read-only CA/secrets, resource limits, restart/health/log policy and a
  deployment guard for immutable image references, TLS identity/key/expiry and
  external network admission. The guard refuses the committed public fixture
  SPKI even in a reissued certificate. Positive guard tests generate fresh keys.
- Keep LiteLLM, vLLM, GenesisBlockDB and persistent state in their existing
  external owners. No new PostgreSQL instance, provider fallback, queue, schema
  migration, production grant, real credential rotation or deployment was added.

The current HTTP worker does not treat aborting a polling request as authority to
cancel its durable job. Its job expiry reaches the model; optional signal support
is available to explicit answer callers. Runtime retains its own claim/process
signal and deadline boundaries. This patch adds no new job-cancellation API.

## Executed evidence

| Check | Result | Scope |
|---|---|---|
| Initial regression runs | Expected RED | Server 17 failures, Runtime unsafe-origin/cancellation failures; response-size and review findings reproduced separately |
| Final combined Server command below | PASS 574/574 across 28 files | Disposable SQLite; provider, vault/Business isolation, Core contracts, grounding/memory, process recovery and Server worker |
| `npm --prefix services/conversation-runtime test` | PASS 116/116, no skips | Includes real TLS sockets, isolated trusted-CA process, wrong-IP certificate, redirects, auth, malformed/empty/reasoning-only responses, cancellation/deadlines and no-fallback errors |
| `npm --prefix services/conversation-runtime run build` | PASS | 12 source files; local Node 24.20.0 boundary/syntax scan |
| `npm --prefix apps/server run build` | PASS | Full Next build on the final Server source; all 94 static pages generated |
| `npm --prefix apps/server run lint` | NOT_PASS | Existing script opens the unconfigured ESLint wizard and exits 1; no lint configuration/dependencies added |
| Production Compose `config --no-env-resolution --quiet` | PASS | Base + Runtime + PRP overlay, synthetic interpolation only; no production env read |
| Deployment guard | PASS / correct refusal | Fresh-key positive and malformed/mismatched/config negatives; public fixture key refused. Earlier synthetic network-admission probe passed before the public-fixture refusal was added; it is not production qualification |
| GPU-free Docker TLS proxy probe | PASS | Production Runtime adapter over two verified TLS hops to mock PRP; listing, valid/invalid key, denied alias and completion |
| Docker proxy negative matrix | PASS 8/8 | HEAD/method, admin, query, denied/missing alias and unsupported-parameter refusals; upstream mock requires the matching HTTP Host |
| Proxy/mock restart recovery | PASS | Same synthetic probe succeeds after restarting owned services |
| Standalone Runtime image build/readiness/drain | PASS | Node 22 image, actual `src/main.js`, synthetic Core/provider; health 200, ready 200, draining 503, exactly one model/completion/send, MODEL_STARTED/MODEL_COMPLETED, exit 0 |
| `npm run govern` | PASS, 0 critical / 0 warning | Final frozen code/doc sources; registry, inventory, identity, graph, generated views and strict preflight |
| `npm run docs:llms` / `docs:llms:check` | PASS | Regenerated ignored corpus and freshness check after entrypoint updates |
| Independent review | No blocking code finding at `f781fb051907ac1d04dc416697870402e88a2869`; report provenance finding corrected in this version | GPT-6 Luna Max, read-only; transport/config/proxy findings and residual durable-worker cancellation scope are documented |
| Actual PRP/LiteLLM/vLLM, GPU, live Business/LINE, production | NOT_VERIFIED / NOT_RUN | No qualified external endpoint, key/model/node receipt or production authority |
| Genesis persistence/Supabase runtime regression | NOT_RUN | Their schema, source, credential configuration and volumes are unchanged; no live-data or fresh storage acceptance claim |
| Hosted CI / release | Not in this local evidence snapshot | The current reviewed head, hosted checks and merge status are tracked on the PR; no release is claimed. |

Final Server command (from `apps/server`):

```sh
npm test -- tests/integration/conversation-runtime tests/integration/fr266-model-provider-credential.test.js tests/unit/business-model-credential-resolution.test.js tests/integration/server-line-jobs.test.js tests/unit/grounded-business-answer.test.js tests/unit/server-line-answer.test.js tests/unit/private-runtime tests/unit/platform/private-runtime-config.test.js tests/unit/platform/model-provider-admin-port.test.js tests/unit/model-provider-port.test.js tests/unit/model-provider-trace.test.js
```

Docker evidence used only projects `zuri-prp-test-20261031` and
`zuri-prp-cr-test-20261031`. Existing operator services were not stopped.
Both disposable projects were removed after verification, without removing
volumes. The eight pre-existing running operator containers remained running.
The second project used a private local Compose override for unused subnet
`10.246.101.0/24`, because this host's default address pool was exhausted.
The proxy image resolved locally to
`nginx@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236`.
That observation is not a platform image approval or vulnerability qualification.

Failed verification attempts were retained in local logs: initial overlapping
subnet; an incorrect fixture bind path (fixed and guarded by a path test);
BusyBox wget lacking CA-file support (replaced with verified curl); exhausted
default Docker address pools; an image drain run whose synthetic claim expired
while waiting (fresh fixture then passed); missing document metadata IDs and stale
generated views (fixed through sanctioned tooling). The TLS virtual-host fixture
returned 421 against the old proxy Host configuration and passed after correction.
The first combined Server run retained 571 passes and three failures: two input
comparisons included different jobs' expiry timestamps; one retrospective-clock
fixture exposed overly broad deadline suppression of normal provider fallback.
Each input now proves its own job expiry, and expiry propagation is restricted to
an actual timeout or explicit cancellation. Affected regressions passed 68/68,
then the complete selected set passed 574/574 on the final source.

## Remaining deployment and acceptance gates

1. Provide an authorized external PRP TEST endpoint and protected Business-scoped
   test key file. Prove exact alias-to-vLLM/model-artifact mapping, a known existing
   forbidden alias, missing model, unsupported fields, invalid key, node outage,
   timeout, rate limit and no public-provider fallback against that endpoint.
2. Qualify actual GPU/container/model readiness, bounded concurrency and local
   persistence/restart behavior in the external PRP owner. Do not infer this from
   a host `nvidia-smi` listing or the mock's OpenAI-compatible response.
3. Provision the key through Zuri's existing write-only Business credential
   lifecycle on an authorized TEST deployment. Verify active Core cohort selection,
   Runtime invocation and durable trace receipts. A healthy container does not
   select or prove the production execution cohort.
4. Retain existing Genesis/Supabase gates and release controls. No production
   infrastructure or database operation was authorized in this task.
5. The requested Vercel-only frontend split remains a proposed ADR-058 amendment
   in the deployment guide. Current supported deployment is the combined Next
   app plus independent Runtime; frontend auth/origin separation was not invented.

## Files in the patch

The following inventory is generated from the composed staged/working diff over
the source revision; ignored local logs, graph/maps/corpus and session notes are
excluded. Tracked generated views are regenerated, never hand-edited.

<!-- patch-files:start -->
```text
apps/server/deploy/private-runtime/check-config.mjs
apps/server/deploy/private-runtime/compose.dev.yml
apps/server/deploy/private-runtime/prp.conf.template
apps/server/deploy/private-runtime/synthetic-key.txt
apps/server/docker-compose.private-runtime.yml
apps/server/runtime/domain-state.json
apps/server/src/modules/agent/grounded-business-answer.js
apps/server/src/modules/agent/model-provider.js
apps/server/src/modules/agent/server-line-answer.js
apps/server/src/platform/integrations/providers/model/model-provider-admin-port.js
apps/server/src/platform/integrations/providers/model/private-runtime-config.js
apps/server/tests/integration/conversation-runtime-group-room.test.js
apps/server/tests/integration/conversation-runtime-legacy-parity.test.js
apps/server/tests/integration/conversation-runtime-model-conformance.test.js
apps/server/tests/integration/conversation-runtime-vertical-slice.test.js
apps/server/tests/unit/grounded-business-answer.test.js
apps/server/tests/unit/platform/model-provider-admin-port.test.js
apps/server/tests/unit/platform/private-runtime-config.test.js
apps/server/tests/unit/private-runtime-deployment.test.js
apps/server/tests/unit/private-runtime-model-port.test.js
apps/server/tests/unit/private-runtime-network.test.js
apps/server/tests/unit/server-line-answer.test.js
docs/README.md
docs/deployment/docker-ngrok.md
docs/deployment/private-runtime.md
docs/features/FEAT-045/verification.md
docs/operations/README.md
docs/plans/PRIVATE-RUNTIME-INTEGRATION-20261031.md
docs/plans/README.md
reports/README.md
reports/private-runtime-integration-20261031.md
services/conversation-runtime/README.md
services/conversation-runtime/docker-compose.smoke.yml
services/conversation-runtime/scripts/Dockerfile.smoke-core
services/conversation-runtime/scripts/mock-private-runtime.mjs
services/conversation-runtime/scripts/probe-private-runtime.mjs
services/conversation-runtime/scripts/smoke-core.mjs
services/conversation-runtime/src/model-port.js
services/conversation-runtime/src/private-runtime-config.js
services/conversation-runtime/test/fixtures/prp-tls/README.md
services/conversation-runtime/test/fixtures/prp-tls/TEST-ONLY-cert.pem
services/conversation-runtime/test/fixtures/prp-tls/TEST-ONLY-key.pem
services/conversation-runtime/test/fixtures/prp-tls/probe-proxy.mjs
services/conversation-runtime/test/model-port.test.js
services/conversation-runtime/test/private-runtime-network.test.js
```
<!-- patch-files:end -->

`source_revision` is the refreshed `main` base; `validated_candidate_revision` binds the local implementation checks and code review above. The current PR head and exact-head hosted CI state are recorded at the linked PR. This report update changes evidence provenance only.
Private local logs, source hashes and the synthetic image-drain receipt are
retained under `.local/prp-evidence/`; they are ignored and are not release receipts.
