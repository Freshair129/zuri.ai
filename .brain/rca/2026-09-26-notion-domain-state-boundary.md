# RCA: Notion callback and webhook readiness projection

## Symptom

The generated domain readiness snapshot reported the documented /oauth/notion/callback as missing from Appendix A and OpenAPI, and classified the signed public webhook as missing a recognizable authorization seam.

## Evidence

- Appendix A lists GET /oauth/notion/callback; CURRENT_API_ROUTE_INVENTORY lists the same path in src/modules/project-manager/api-docs/openapi.js.
- apiCheck accepted only /api/ paths from both sources.
- The webhook route declares @public-provider-endpoint and delegates event verification to receiveNotionWebhook, which checks the exact-body HMAC before writing a receipt.
- The generated integration-domain snapshot showed API-INVENTORY-001, API-OPENAPI-001, and AUTH-001 for this feature.

## Root Cause

The readiness projection assumed every server route starts with /api/ and every write authorization seam resolves a browser viewer. Notion's specified OAuth callback is unprefixed, and its webhook uses provider-signature authentication.

## Why the issue escaped detection

Notion's focused integration and OpenAPI tests verified the endpoint behavior and contract, but no test asserted that the generated readiness projection recognized non-/api callbacks or signed provider webhook seams.

## Proposed prevention

Treat documented /oauth/ callbacks as API paths in readiness checks, recognize the explicit provider-auth marker with its receiver seam, and assert the generated integration-domain API and authorization checks after governance regeneration.
