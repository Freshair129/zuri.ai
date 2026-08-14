---
version: "0.1.0b"
created_at: "2026-08-14T09:27:04+07:00,ATHER"
last_update: "2026-08-14T09:39:48+07:00,ATHER"
status: "beta"
attributes:
  domain: "line-ai"
  doc_type: "root-cause-analysis"
  scope: "FR-052 Supabase Session Pooler TLS trust"
---

# RCA - Supabase Session Pooler CA trust

## Complexity and risk

- **Complexity:** C-2 - documentation-driven security fix
- **Risk:** HIGH - production database transport authentication

## Symptom

The FR-052 operator provisioner reaches the IPv4 Supabase Session Pooler but aborts before
Postgres authentication with `self-signed certificate in certificate chain`.

## Evidence

- The direct project endpoint resolves only to IPv6 on this network and Node.js reports
  `ENOTFOUND`; the Session Pooler resolves to IPv4 and TCP port 5432 is reachable.
- The Session Pooler attempt advances to TLS negotiation and then fails certificate validation.
- Both provisioning and runtime probe clients set `rejectUnauthorized: true` but provide no CA.
- URL normalization deliberately removes `sslrootcert` and other caller-selected TLS overrides,
  so the client has no trusted Supabase root certificate.
- Supabase's current SSL enforcement guide requires the project CA for `verify-full` and exposes
  `prod-ca-2021.crt` through Database Settings.
- The published Supabase Root 2021 CA is self-issued, valid until 2031-04-26, with SHA-256
  certificate fingerprint
  `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

## Root Cause

The implementation enabled strict Node.js TLS verification without supplying the Supabase CA
trust anchor required by the Session Pooler's certificate chain. This is a client configuration
defect, not a database password or RLS failure.

## Why the issue escaped detection

Unit tests injected fake `pg.Client` implementations and asserted rejection of unsafe URL TLS
overrides, but did not exercise a live Supavisor certificate chain. The first live attempt used the
unreachable IPv6 direct endpoint, so TLS validation was not reached until the Session Pooler retry.

## Proposed prevention

1. Add the public Supabase Root 2021 CA as a pinned, non-secret repository asset.
2. Validate its exact SHA-256 fingerprint before creating either admin or runtime clients.
3. Pass the validated PEM as `ssl.ca` with `rejectUnauthorized: true`; keep hostname validation on.
4. Continue deleting caller-controlled `sslmode`, `sslrootcert`, `sslcert` and `sslkey` URL fields.
5. Add tests proving missing, modified and unexpected CA files fail before network access.
6. Run the live FR-052 permission probe before activating the LINE binding.

Explicitly forbidden: `rejectUnauthorized: false`, `sslmode=no-verify`, disabling SSL enforcement,
or accepting an arbitrary CA path from the connection string.

## Acceptance criteria

- The Session Pooler TLS handshake passes only with the pinned expected CA.
- Wrong database credentials return an authentication error rather than a TLS trust error.
- Direct base-table reads remain denied.
- `SET LOCAL ROLE zuri_line_smartgift_ro` exposes exactly 74 approved rows and zero foreign rows.
- Mutation remains denied and LINE binding remains `PENDING` until the final LINE canary.

## Resolution and verification

The approved remediation is implemented with a repository-pinned CA, exact certificate
fingerprint validation and strict Node.js TLS options shared by the admin and runtime clients.
Unit tests cover missing, malformed and modified CA input. A live Session Pooler handshake using a
deliberately invalid password reached Postgres and returned `28P01`, proving CA and hostname
validation passed without authenticating or reading data.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Documented the missing Supabase CA trust anchor and fail-closed remediation | working-tree | ATHER |
| 0.1.0b | 2026-08-14 | beta | Implemented pinned CA verification and proved the live TLS handshake reaches Postgres authentication | working-tree | ATHER |
