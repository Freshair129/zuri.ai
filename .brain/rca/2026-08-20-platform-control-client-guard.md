# RCA — Platform Control client-only guard

## Symptom

The initial `/control/roadmap` implementation used a client guard. An unauthenticated
browser redirected after hydration, but the static route could render board HTML first.

## Evidence

Vercel classified `/control/roadmap` as static (`○`) in the first production build.
The guard fetched `/api/viewer` only in a client component.

## Root Cause

Authorization was evaluated after the App Router had rendered the route's static
content. Redirecting client-side protects interaction, not the server response body.

## Why it escaped detection

The first browser check observed the settled URL after hydration and did not inspect
the initial server response classification.

## Prevention

Installation-only routes use a server guard that resolves the trusted viewer before
rendering children. Deployment verification checks the route is dynamic and an
unauthorised response has no board text.
