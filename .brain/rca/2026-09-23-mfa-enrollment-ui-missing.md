# RCA — MFA enrollment UI missing from the authenticated profile

## Symptom

The production profile has no visible Security or TOTP setup entry point, so an
owner cannot enroll the authenticator factor required before saving a Provider
key or performing another credential-gated write.

## Evidence

- `apps/server/src/app/(pm)/profile/page.jsx` rendered Account, Language, LINE
  link and Sessions cards, but no MFA surface.
- The canonical MFA routes already existed:
  `/api/auth/mfa/factors`, `/api/auth/mfa/totp/enroll` and
  `/api/auth/mfa/totp/verify`.
- The provider credential gate requires an active TOTP factor and an AAL2
  session; the backend correctly refused to bypass that contract.
- MFA lifecycle integration tests existed, but no profile render or browser
  coverage asserted that a user could reach enrollment.

## Root Cause

MFA lifecycle implementation was delivered at the identity service and API
layers, while the authenticated profile remained a read-only account surface.
The follow-on UI gate was documented but not wired into the page that users
could actually find.

## Why the issue escaped detection

The service and integration tests proved factor creation, activation and
session assurance in isolation. The existing profile tests did not render the
page with its live API composition, and the production readiness review
checked the provider gate without a discoverability/e2e assertion for MFA
enrollment.

## Proposed prevention

Keep the MFA API behind the canonical identity service, add a profile render
contract for the enrollment entry point and redacted status, and add a browser
acceptance path that verifies manual QR enrollment and AAL2 elevation without
recording secrets or OTP values. Production readiness must continue to require
the deployed UI, active factor, AAL2 step-up and the downstream canary receipt.
