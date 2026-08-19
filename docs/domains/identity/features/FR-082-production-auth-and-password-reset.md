---
domain: identity
feature: FR-082
module: identity
source: v2-native
---

# FR-082 — Production authentication and password reset contract

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-19 |
| **Relates to** | FR-044, FR-046, SDD-024, SEC-008, SEC-015 |

## User story

As a Zuri user, I want to log in using my username/email and password or request a password reset, so that my account access is securely authenticated without reliance on demo credentials or fallback stubs.

## Requirements

1. WHEN a user submits valid credentials to `POST /api/auth/login` THEN the system SHALL verify the salted password hash against `PersonCredential`, issue an HTTP-only `zuri_session` cookie, and return `200 OK` with user profile info and redirect URI.
2. WHEN a user submits invalid credentials to `POST /api/auth/login` THEN the system SHALL return `401 Unauthorized` with `{ error: 'INVALID_CREDENTIALS' }`.
3. WHEN a user calls `POST /api/auth/logout` THEN the system SHALL clear the `zuri_session` cookie and return `200 OK`.
4. WHEN a user requests a password reset via `POST /api/auth/forgot-password` with a valid email or username THEN the system SHALL generate a secure 32-byte single-use `PasswordResetToken` valid for 1 hour and return `200 OK`.
5. WHEN a user submits a valid token and new password to `POST /api/auth/reset-password` THEN the system SHALL update the `PersonCredential` password hash, mark the token as consumed, and return `200 OK`.
6. IF an invalid or expired reset token is submitted to `POST /api/auth/reset-password` THEN the system SHALL return `400 Bad Request` with `{ error: 'INVALID_OR_EXPIRED_TOKEN' }`.

## Acceptance criteria

- [x] AC-082-01 Valid username/email and password credentials return 200 and set secure session cookie.
- [x] AC-082-02 Invalid credentials return 401 without creating session cookies.
- [x] AC-082-03 Logout clears session cookie immediately.
- [x] AC-082-04 Forgot password requests issue a single-use token with 1-hour expiry.
- [x] AC-082-05 Reset password updates `PersonCredential` hash and invalidates the token.
- [x] AC-082-06 Login surface is credential-wired and contains no demo stubs or demo fallback labels.
