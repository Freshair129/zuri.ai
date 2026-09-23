---
version: "0.1.0b"
status: "candidate"
attributes:
  domain: "agent-governance"
  doc_type: "complexity-rule"
  scope: "TASK-ZAI-001"
---

# RCA: web recreation left the KI17 worker in a dead shared namespace

## Symptom

The deployed web and line-worker containers were healthy, but the documented
read-only KI17 relay smoke returned `pipeline_worker_unavailable` for the
MSP-to-worker hop.

## Evidence

- The `genesis-worker` health state was stale-healthy after `web` had been
  recreated onto the new image.
- A TCP check from the web container to `127.0.0.1:19417` returned
  `ECONNREFUSED`.
- Compose defines `genesis-worker` with `network_mode: service:web`, so its
  loopback namespace belongs to the web container instance.
- Recreating `genesis-worker` without changing its image restored TCP
  connectivity and the read-only smoke passed both MSP-to-GKS and MSP-to-worker
  hops.

## Root Cause

The deployment recreated `web` but named only `web` and `line-worker` in the
first `compose up` command. Because the KI17 worker shares web's network
namespace, the old worker remained attached to the replaced web namespace and
its health status no longer described the live namespace.

## Why the issue escaped detection

The web healthcheck and the worker's TCP healthcheck were both green/stale at
the handoff boundary, while the operator P-5 smoke was run only after the web
recreate. The compose topology warning already documented this risk, but the
first deployment command did not include the knowledge-profile worker.

## Prevention

After every web recreation on a KI17 host, explicitly recreate the
`genesis-worker` service with the knowledge profile, then require TCP and the
read-only P-5 smoke to pass before accepting the deployment.

## Resolution

Recreated `genesis-worker` using the existing pinned image
`zuri-ai-genesis-worker:release-a9039-msp-68e6169-genesis-5156f41`; no worker
image or source change was made. The container became healthy, TCP connected,
and P-5 passed with `empty_page` and `published_generation` outcome codes.
