# RCA — Sidebar domain heading was used as navigation

## Symptom

The active domain name in the sidebar was clickable. For Development, clicking
the heading navigated to `/overview`, while the sidebar sub-domain list started
at `Projects` instead of exposing `Overview` as its first entry.

## Evidence

- `src/components/layouts/Sidebar.jsx` rendered the domain heading as a `Link`
  with `href={domain.basePath || domain.sub[0].path}`.
- `src/config/domains.js` defined Development with `basePath: '/overview'` but
  did not include `/overview` in `domain.sub`.
- `tests/unit/sidebar-visible-subdomains.test.js` explicitly asserted that
  `/overview` was excluded from the Development sidebar.
- `docs/SITEMAP-V2-DOMAIN-NAV.md` documented the same behavior as the accepted
  navigation contract.

## Root Cause

The sidebar header and the domain's first sub-domain were coupled through the
domain root fallback link. The registry treated Development's BusinessShell
root as a domain-level link instead of modeling it as the first sidebar
sub-domain, unlike the Dashboard-first contract used by the other domains.

## Why the issue escaped detection

The implementation, unit test, e2e test, and navigation documentation all
agreed with the older contract, so automated checks verified the wrong
interaction rather than the intended sidebar hierarchy.

## Proposed prevention

- Keep domain headings in the sidebar as non-interactive context labels.
- Represent the first navigable sidebar surface explicitly in `domain.sub`.
- Test both the semantic element type of the heading and the first sub-domain's
  label/path.
- Treat the sitemap and generated documentation checks as part of navigation
  changes.
