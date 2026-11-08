---
id: ZAI:AUTHENTICATION-RATE-LIMITS-20261108
doc_type: change-request
title: Password login and TOTP rate limits
status: approved
version: "0.1.0"
approved_on: "2026-11-08"
relations: [{"type":"references","target":"ZAI:FR-046"},{"type":"references","target":"ZAI:FR-191"},{"type":"references","target":"ZAI:SEC-026"},{"type":"references","target":"ZAI:FR-224"}]
---

# Password login and TOTP rate limits

## Approval

On 2026-11-08 the owner reviewed a login security assessment that found no
rate limit on `POST /api/auth/login` and recommended closing that gap first.
The owner replied “approve”. The lead session bounded that instruction to the
two statements below and their implementation in the Identity domain. This
note records that instruction as approval for issuing FR-296 and FR-297. It does not authorize a schema change, migration,
production operation, deployment, or broader authentication redesign.

## Approved statements

### Password login

> Password login is rate-limited: before credential verification, attempts
> consume durable atomic 15-minute fixed-window limits of 10 per normalized
> identifier and client address, 50 per normalized identifier, and 200 per
> client address. A limited request returns the same generic 429 response for
> a known, disabled, or unknown identifier; other limiter failures fail closed
> with AUTH_UNAVAILABLE.

### TOTP verification

> TOTP code verification is rate-limited per Person: before code verification,
> enrollment-confirmation and TOTP step-up attempts share a durable atomic
> limit of five attempts per 15 minutes. A limited request returns MFA_RATE_LIMITED
> with a retry delay; WebAuthn step-up remains a separate verification path.

## Delivery boundary

The existing RateLimitBucket and compare-and-set limiter are reused. The
canonical records use `planned` delivery status until the normal review and
merge process records otherwise. Local tests and governance do not establish
production deployment or activation.
