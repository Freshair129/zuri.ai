# RCA — Dev page rendered without CSS assets

## Symptom

The page at `http://localhost:3100` rendered as unstyled default HTML. Tailwind
utilities, global tokens, and the landing page CSS module were not applied.

## Evidence

- The HTML response linked `/ _next/static/css/app/layout.css` and
  `/ _next/static/css/app/page.css` (without the spaces in the actual URLs).
- Both stylesheet requests returned HTTP 404.
- `src/app/layout.jsx` imports `./globals.css`, and `globals.css` contains the
  Tailwind directives and application tokens.
- `tailwind.config.js` includes `./src/**/*.{js,jsx}` and the server returned
  class names in the HTML, so the source-level CSS pipeline is configured.
- `.next/static/css` contained generated hash-named files but no `app` CSS
  assets matching the paths referenced by the running HTML.
- An existing Next dev server was already running on port 3100 before this
  diagnosis.

## Root Cause

The running Next dev server had a stale/inconsistent `.next` development asset
manifest: the HTML referenced app CSS paths that were no longer present under
`.next/static/css`. This is a generated-runtime state problem, not a missing
`globals.css` import or a Tailwind selector defect.

## Why the issue escaped detection

The HTML route returned HTTP 200 and contained the expected content, so a route
smoke check could pass while the stylesheet requests were 404. The existing
server was reused across dependency/build activity, allowing the stale asset
state to remain visible.

## Prevention

- Treat CSS asset 404s as a failed dev-server smoke check.
- Restart the dev server after dependency installation or `.next` regeneration.
- Verify both the HTML response and each linked stylesheet before visual UAT.
- Keep generated `.next` state out of release/readiness claims.
