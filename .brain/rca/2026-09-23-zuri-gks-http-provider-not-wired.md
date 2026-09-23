---
version: "0.1.3b"
created_at: "2026-09-23T19:48:12+07:00,RWANG,base 49d1808b"
last_update: "2026-09-23T23:51:25+07:00,RWANG"
status: "beta"
attributes:
  domain: "knowledge"
  doc_type: "root-cause-analysis"
  scope: "Zuri MSP-to-GKS private HTTP canary integration"
---

# RCA — Zuri GKS HTTP provider not wired end to end

## Symptom

The current Zuri Knowledge runtime and deployment could not use the merged MSP-to-GKS
HTTP provider as a service. If selected, the MSP child would lack its explicit HTTP
provider settings and bearer credential; there was no GKS HTTP Compose service or
private route in Zuri. The separate `/knowledge` UI is not itself a GKS API endpoint.

This is a pre-canary integration gap, not evidence of a production outage. No production
traffic, credentials, containers or data were involved in its diagnosis.

The first pull-request CI run then exposed a separate Edge contract-test failure: the
allowlist declarations had moved to the shared Server helper, while the Edge test still
searched the former transport file for inline declarations.

## Evidence

- Zuri `msp-stdio-transport.js` originally allowlisted MSP stdio settings only and did
  not forward `MSP_GKS_TRANSPORT`, `MSP_GKS_HTTP_URL` or the GKS MSP bearer value.
- The pinned MSP HTTP provider reads those explicit settings and sends an HTTP Bearer
  header; GKS HTTP refuses to start unless MSP authentication is required and the
  matching credential is configured.
- Zuri's existing Compose configuration had the `runner-ki17` image and worker, but no
  long-lived GKS HTTP service, private network or service-health dependency.
- The base Compose file also loaded `.env`, `.env.docker` and `.env.knowledge` by fixed
  paths and started ngrok by default. A distinct project name alone would therefore not
  guarantee isolated runtime credentials or the absence of a public tunnel.
- While wiring the overlay, review found a second seam: mounting the bearer file only in
  `gks-http` would authenticate requests server-side but leave the web/worker MSP
  children without the matching credential. The corrected overlay mounts that secret in
  each trusted parent, and the transport reads the file and passes only its value to MSP.
- Reviewing the pinned GenesisBlock worker call site showed its MSP child receives
  `{ ...process.env, ...env }`. Therefore the web transport allowlist alone did not
  constrain worker-side MSP. The pipeline contract also requires the caller credential
  material MSP passes to GKS to equal the server verifier value; withholding that
  material from MSP would break authorized pipeline calls.
- Existing transport tests exercised the stdio allowlist and did not test HTTP-mode
  environment filtering, secret-file propagation or Compose topology.
- The prior G-3 Linux acceptance used an older recorded MSP/GKS tuple. It does not prove
  this HTTP integration or its canary behavior.
- PR #537's `edge-verify` failed in
  `apps/edge/tests/unit/genesisrag17-edge.test.ts`: its `namesIn` helper searched
  `msp-stdio-transport.js` for `export const ... = Object.freeze([...])`, but the Server
  allowlist arrays now live in `msp-child-environment.mjs` and are re-exported by the
  transport. The shared Server helper also adds `MSP_GKS_TRANSPORT`,
  `MSP_GKS_HTTP_URL` and `GKS_MSP_RELAY_CREDENTIAL`, which Edge's stdio-only caller must
  not receive.

## Root cause

The upstream HTTP provider and server had been merged in MSP and GKS, but Zuri's pinned
build inputs, process-environment paths and Compose graph still represented the
stdio-only integration. The repository boundary had no end-to-end contract test tying
provider variables and both caller credentials to each runtime child and the service
network. The worker's upstream launcher inherited its entire environment, bypassing a
filter implemented only in the web transport. The initial overlay also mounted the
secrets only at the server instead of all trusted parents, and an earlier boundary
description incorrectly implied the pipeline credential material could be withheld
from MSP despite the equal caller/verifier contract. Separately, the canary's stated
isolation constraints were not enforceable while Compose loaded the normal env files by
fixed paths and left ngrok enabled in its unmodified default service graph. The subsequent
Edge CI failure was caused by a test that coupled the cross-repository contract to the
old source-file location rather than the shared helper; the test also needed to model the
intentional Server-only HTTP variables as well as MemoryOS authority.

## Why the issue escaped detection

Cross-repository provider tests proved the HTTP client/server contract in isolation;
Zuri's existing tests proved its web stdio path, while worker launcher inheritance was
outside that path. The older container acceptance tested the recorded release tuple,
not the new HTTP target or a private service route. No Zuri regression test asserted
both caller processes' environment filtering, mounted-secret delivery, private-network
membership, absence of a host port, or image-pin alignment. The dashboard screenshot
showed a UI page, which cannot establish API/runtime wiring. The focused Server tests did
not run the Edge package's static cross-repository allowlist test, so its source-location
assumption was caught only by hosted `edge-verify`.

## Proposed prevention

- Keep stdio as the default and rollback path; select HTTP only through the explicit
  opt-in overlay.
- Test the shared MSP child allowlist in both web and worker launch paths, file-backed
  bearer and pipeline-caller delivery, fail-closed missing/empty files, pinned HTTP
  entrypoints and private Compose topology in Zuri.
- Keep Edge's stdio contract test anchored to the shared Server environment helper;
  explicitly exclude Server-only MemoryOS and HTTP-provider names, and assert Edge never
  forwards either set.
- Keep a separate canary evidence gate (G-9): fresh project and volumes, authenticated
  success plus wrong/missing-bearer and wrong-scope denials, persistence, backup/restore,
  and confirmation that GKS has no host port, public URL or ngrok route.
- Route canary env files through explicit Compose path selectors and use a canary-only
  overlay that disables ngrok; keep the normal default paths and ingress behavior intact.
- Re-pin Zuri to the merged release commit before release; do not treat the historic G-3
  acceptance or local tests as a passed HTTP canary or production readiness.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.3b | 2026-09-23 | beta | Records PR #537 edge-verify source-location failure and aligns Edge's contract test with the shared helper and Server-only HTTP names | working-tree | RWANG |
| 0.1.2b | 2026-09-23 | beta | Adds the worker env-inheritance root cause and corrects the equal pipeline caller/verifier credential boundary | working-tree | RWANG |
| 0.1.1b | 2026-09-23 | beta | Adds the local-canary env-file and ngrok isolation gap found during integration review | working-tree | RWANG |
| 0.1.0b | 2026-09-23 | beta | Recorded the Zuri HTTP integration gap and its prevention gates before canary execution | working-tree | RWANG |
