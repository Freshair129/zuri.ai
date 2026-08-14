# RCA — Demo session endpoint returned NOT_FOUND

## Symptom

Opening `http://localhost:3100/api/session/demo` showed `{"error":"NOT_FOUND"}`.

## Evidence

- `src/app/api/session/demo/route.js` implements only `POST`.
- `src/app/login/page.jsx` submits to the route with `method="post"`.
- A direct `GET` to the endpoint is not the supported login flow.
- A `POST` while `ZURI_LOCAL_DEMO_AUTH` was unset returned `404 {"error":"NOT_FOUND"}`.
- After starting the dev server with `ZURI_LOCAL_DEMO_AUTH=1`, `POST /api/session/demo`
  returned `303 See Other`, redirected to `/businesses`, and set the local demo cookie.

## Root Cause

The endpoint is a non-production, POST-only demo-session capability and fail-closes
when `ZURI_LOCAL_DEMO_AUTH` is not enabled. The browser was pointed at the API URL
instead of the `/login` UI, and the manually started server also lacked the required
local demo environment flag.

## Why the issue escaped detection

The route intentionally returns the same `NOT_FOUND` response when the capability is
disabled, so an environment-startup mistake looks like a missing route. The address
bar test also bypassed the Login form and used the wrong HTTP method.

## Prevention

- Start local preview with `ZURI_LOCAL_DEMO_AUTH=1`.
- Enter through `/` or `/login`; do not open `/api/session/demo` directly.
- Keep the route's production fail-closed behavior unchanged.
