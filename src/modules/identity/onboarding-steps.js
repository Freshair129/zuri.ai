// @req FR-066 — the FR-066 journey's step → surface map, stated once and
// imported by every pre-Business page so the routing answer cannot drift
// between surfaces (ADR-027 D8 route plan).
// @spec SDD-038
// @tested tests/unit/onboarding-service.test.js
// No I/O and no imports on purpose: consumed by client components.

// WORKSPACE_HOME is `/workspace-home`, not ADR-027 D8's provisional
// `/workspaces`: that path is already served by the Project Manager's Space
// compatibility page (src/app/(pm)/workspaces), which the ADR says "may later
// move to a /spaces route" — moving it is that later slice's work, and two
// parallel pages on one path is a Next.js build error today.
export const ONBOARDING_STEP_PATHS = Object.freeze({
  PROFILE: '/onboarding/profile',
  WAITING_ROOM: '/waiting-room',
  WORKSPACE_HOME: '/workspace-home',
  BUSINESS_ROUTING: '/businesses',
})

export function onboardingPathFor(nextStep) {
  return ONBOARDING_STEP_PATHS[nextStep] || ONBOARDING_STEP_PATHS.PROFILE
}
