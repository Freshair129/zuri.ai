---
doc_type: change-request
title: Local Zuri documentation graph studio
status: approved
superseded_by: null
version: "0.9.0"
date: "2026-10-19"
risk: MEDIUM
---

# Local Zuri documentation graph studio

## Approval

The user's direct request on 2026-10-19 authorizes connecting the existing
Knowledge Graph Studio to Zuri. The user's 2026-10-20 request authorizes
packaging and deploying the Zuri integration. This change records the
implementation boundary: an installation-operator-only, read-only document
browser that uses Zuri's generated document graph and canonical document files,
with the captured renderer reached only through its local loopback host.

The deployment request does not change the renderer's redistribution boundary:
the captured component bundle is not copied into Zuri's public repository or
image while its license remains unverified. The Zuri application stores only the
bridge and document-data adapter. Every graph and Markdown API request rechecks
installation-operator authority. No Business knowledge corpus or network
synchronization is added.

The approved standalone authored requirement candidate is: "Zuri Knowledge
Studio is an installation-operator-only, read-only browser for the indexed Zuri
Markdown document graph. Operators can search and browse documents, filter
graph nodes by kind and neighbor hops, use domain groupings derived only from
explicit graph relations or document metadata, inspect each node's exact source
path, and read its Markdown in a same-page viewer. Domain ownership is never
inferred from directory names; explicit metadata and graph relations determine
a unique domain grouping. When no unique domain exists, sources under
docs/services are grouped in Services (unassigned), and other sources are
grouped in Shared (unassigned). The graph and Markdown come only from the
generated document graph and available repository source files. The original
graph component must run on the operator's browser machine at a loopback
origin; the view reports unavailable when it cannot connect, and Zuri does not
host or redistribute the captured component bundle. The page and each graph or
document API request require installation-operator authority and fail closed
for node IDs absent from the graph, unsafe paths, or missing source files." It is a new authored
ZAI requirement, not a historical-row migration, and remains planned until its
delivery gates pass. ADR-048 D5 scopes the API-backed documentation surface
separately from the original `/control/roadmap` static projection; SEC-020 and
FR-105 remain in force for that original board.

## Existing evidence and scope

The generated Zuri document graph contains document, requirement, feature,
domain, ADR, roadmap and appendix records with typed relations. The projection
includes only Markdown paths present in the generated graph and present on disk.
Domain grouping comes from explicit document metadata or typed `owned_by` and
feature `bundles` relations; other files remain in Shared or Services until an
explicit owner relation exists.

The reader uses the exact source Markdown file for each node. The local graph
host receives bounded node and edge data through `postMessage`; the Zuri server
does not serve arbitrary paths or accept writes. Missing local host, stale graph,
unknown document IDs and unavailable source files fail with explicit errors.
Start the extracted local host from its own folder with
`node server.mjs --host 127.0.0.1 --port 19860`. Zuri defaults to this loopback
origin; a different loopback port can be selected through
`NEXT_PUBLIC_ZURI_KNOWLEDGE_STUDIO_ORIGIN`. The renderer files stay outside the
Zuri repository and must remain local.

## Acceptance criteria

1. `/control/knowledge-studio` remains inside the installation-operator guarded
   Platform Control layout, and each API request independently checks that role.
2. The graph is built from the current generated document graph and canonical
   document index. Node IDs, source paths and typed relations are stable and
   bounded; grouping without explicit ownership evidence is labelled shared.
3. The local original graph, camera and detail panel receive this caller data
   through a loopback-only bridge. Captured component files are not copied into
   the public Zuri repository.
4. Domain groupings use explicit ownership evidence only and take precedence
   over the `docs/services/` path classification. Sources under
   `docs/services/` without a unique domain appear in Services (unassigned);
   other sources without a unique domain appear in Shared (unassigned). Each
   node exposes its exact source path, while search, node-kind and hop filters
   and the same-page Markdown reader operate on indexed documents.
5. The viewer is read-only, uses no Business corpus or database, and fails closed
   for unauthorized requests, node IDs absent from the graph, unsafe paths,
   missing Markdown source files and an unavailable local component host. A
   separate canonical registry row is not required when the generated graph
   contains the document and its indexed source is available.
6. Focused tests, documentation governance, build and browser checks must pass
   and be recorded below before implementation is considered verified.
7. An isolated local Compose deployment may initialize only its newly created,
   empty local database and its own local secrets. It must bind to loopback and
   leave existing UAT stacks, external databases, production data and unrelated
   services untouched. Local deployment evidence is not public deployment or
   public-origin smoke evidence.

## Verification record — 2026-10-20

Validated in worktree `codex/knowledge-studio-zuri`, based on
`5a0a956a3ac03e1bdc97b253f83bc5eddfc56823` (`origin/main`). The working tree
was not yet committed when these checks ran.

| Check | Result | Evidence |
|---|---|---|
| Focused Knowledge Studio, route, adjacent operator-control, and bootstrap tests | PASS | 11 files / 93 tests passed with `node scripts/assert-tests-ran.mjs vitest run tests/unit/knowledge-studio tests/integration/openapi-docs.test.js tests/unit/platform-control-access-denied.test.js tests/unit/fr124-product-readiness-ui.test.js tests/unit/fr123-plugin-consent-view.test.js tests/unit/programme-member-view.test.js tests/unit/platform-control-route-contract.test.js tests/unit/knowledge-documents-ui.test.js tests/unit/knowledge-data-pipeline-map-ui.test.js` |
| Browser E2E with the original local renderer | PASS | 1 test passed with `ZURI_E2E_ORIGINAL_RENDERER=1`; renderer stayed on browser-machine loopback |
| Browser E2E with the repository-owned CI fixture | PASS | 1 test passed without the captured bundle or a pre-running renderer |
| Next.js production build | PASS | `NEXT_OUTPUT=standalone npm run build` completed and generated 94 static pages |
| Docker runner image | PASS | Compose rebuilt the `zuri-ai-knowledge-studio:next15` runner from this source; image digest `sha256:7aeeafbc993d03f04782a0233e878b010392c5bfabad25ca5342a11f1daf3900` |
| Standalone runtime contents | PASS | Image probe confirmed Next.js 15.5.28, `/app/server.js`, both Prisma clients, absence of Playwright, no `node_modules/exceljs` directory, and zero case-insensitive `exceljs` string matches in `.next/server`. These probes do not establish complete module reachability for bundled or minified code. |
| Production dependency audit | PASS WITH MODERATE FINDINGS | `npm audit --omit=dev`: 0 critical, 0 high, 2 moderate findings in `exceljs`/`uuid`. ExcelJS remains a declared production dependency used by XLSX workflows; the runtime package-directory check is not evidence that all bundled code is absent. The builder's full development dependency tree is not clean and is not represented as clean. |
| Bootstrap operator CLI in the packaged tools image | PASS | Fixed file-URL entry detection for Linux and Windows; `bootstrap-operator-cli.test.js` passed 6 tests and the local fresh database accepted the first-operator bootstrap. |
| Isolated local Compose deployment | PASS | Project `zuri-knowledge-studio-local-20261020`; refreshed `web` and existing `db` are healthy; `db-migrate` exited 0 on initial setup; `/api/health` returned 200 with `db=ok`; only port `127.0.0.1:3101` is published; no `ngrok` service was started; docs and registry mounts report read-only. The app image was updated without restarting dependencies or changing the volume. |
| Public ingress default and opt-in | PASS | Compose config lists no `ngrok` service by default and lists it with `--profile public`; deployment wrappers require explicit `-Public`/`--public`, non-empty token plus assigned domain, and reject a resolved `COMPOSE_PROFILES=public` in local mode. Shell syntax, config parse, and the Docker runtime contract test passed. |
| Authenticated local browser and Markdown bridge smoke | PASS WITH ORIGINAL-RENDERER WARNINGS | Operator login 200; bridge reported 1,162 documents / 3,095 relations; graph API 200; exact Markdown API returned 30,295 characters from `docs/domains/agent/features/INVENTORY-FR-150-edge-desktop-ui.md`; the original iframe received the same source path and Markdown payload. |
| Original renderer browser error stream | WARNING | 65 repeated `TypeError: Failed to fetch` errors originate in the original renderer's blob-based `getFontsForString` path. No failed HTTP responses were observed; the graph reached `Connected`, the file tree populated, and the Markdown round-trip passed. This is not a clean browser-console result. |
| Documentation governance | PASS WITH WARNINGS | `npm run govern`: 0 critical, 5 warnings, 40 info; includes 13 dangling annotation edges, 3 broken references, and the two new untracked docs while this change remains uncommitted. |
| Generated corpus freshness | PASS | `npm run docs:llms` generated 414 KB; `npm run docs:llms:check` reported `llms-full.txt is up to date`. |
| Public ngrok deployment | NOT CONFIGURED | No ngrok CLI, token or assigned domain is available in this environment; no public tunnel has been started. Compose and wrappers now default to local-only; public mode requires explicit selection plus a token and assigned domain. |
| Broad `npm test` | INTERRUPTED | The full suite was stopped before completion; it is not a passing result. The focused tests above are the completed test evidence. |

The renderer fixture is test-only. The captured renderer remains outside the
repository and image because its redistribution rights are still unverified.

## Deployment status

LOCAL DEPLOYED ONLY at `http://127.0.0.1:3101/login` under Compose project
`zuri-knowledge-studio-local-20261020`. The `web` and fresh local Postgres
containers are healthy; the one-shot schema push exited 0. The deployment binds
only to loopback and uses its own randomly generated local credentials and new
named volume. Existing UAT stacks, their databases, and port 3000 were left
untouched. The graph and registry files are mounted read-only into the web
container. The initial operator account is local-only; its one-time password was
returned directly to the user and is not stored in this repository.

The authenticated smoke logged in as the installation operator, loaded the
original component and its generated graph (1,162 documents, 3,095 relations),
read an exact indexed Markdown source through Zuri's guarded API, and received
the 30,295-character source back in the original component iframe. The UI
reported `Connected` and the file tree showed the indexed source path. The
browser also recorded 65 repeated `Failed to fetch` errors in the renderer's
blob-based `getFontsForString` path. No HTTP requests failed, and graph plus
Markdown behavior worked, but this is not a clean browser-console result. The
captured renderer stays on the local browser host at `127.0.0.1:19860` and is
still excluded from the public repository and image because redistribution
rights remain unverified.

PUBLIC DEPLOYMENT NOT CONFIGURED. No ngrok executable, authentication token, or
assigned domain is available in this environment. No ngrok container or public
tunnel was started; the local deployment is not represented as a public or
production deployment.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0 | 2026-10-19 | approved | Record the bounded local documentation-studio integration requested by the user | uncommitted | Codex |
| 0.2.0 | 2026-10-19 | approved | Document the loopback renderer launch and configurable local origin | uncommitted | Codex |
| 0.3.0 | 2026-10-20 | verified locally; deployment pending | Record exact local validation and the missing isolated deployment target | uncommitted | Codex |
| 0.4.0 | 2026-10-20 | public deployment held | Record the production dependency audit blocker and preserve no-write deployment boundary | uncommitted | Codex |
| 0.5.0 | 2026-10-20 | local deployed; public target unavailable | Record the isolated Compose deployment, authenticated graph/Markdown smoke, bootstrap CLI fix, and original-renderer warning | uncommitted | Codex |
| 0.6.0 | 2026-10-20 | approved | Approve the standalone authored FR-289 statement and clarify its separate read-only API surface under ADR-048 D5 | approval-base | Codex |
| 0.7.0 | 2026-10-20 | approved | Bound FR-289 to the loopback renderer, explicit grouping evidence, source-path detail, and actual graph/source fail-closed conditions | approval-base | Codex |
| 0.8.0 | 2026-10-20 | approved | State precisely how domain, unassigned-service, and shared groupings are derived | approval-base | Codex |
| 0.9.0 | 2026-10-20 | approved | Make explicit domain ownership take precedence over service-path grouping | approval-base | Codex |
