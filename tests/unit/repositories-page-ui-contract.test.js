// @req FR-073 — Register repository must succeed for a real viewer, not just
// at the schema/service layer. `zRepositoryInput` requires businessId
// (src/lib/validation/entities.js ~line 280), but RepoModal's create submit
// never sent it and the form had no field for it — every create was rejected
// with "Validation failed: businessId: Required". Editing an existing
// Repository was unaffected because PATCH does not require businessId.
//
// The repair sources businessId from the trusted active-business context the
// rest of the shell already uses (scope.shell.activeBusinessId — the same
// source src/app/(pm)/files/page.jsx and src/app/(pm)/overview/page.jsx read),
// never from a free-text field a caller could type into: that would let the
// client choose its own scope, which is exactly what BR-001 and the
// ownsBusiness gate on the server (repository-service.createRepository) exist
// to prevent.
//
// These are source-contract assertions in the style the rest of this suite
// uses (see tests/unit/projects-dashboard-ui.test.js) — this project's client
// components run under a node test environment with no DOM, so the page
// source is the render surface under test.
// @spec BR-001, SEC-001, SEC-008
// @tested tests/unit/repositories-page-ui-contract.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zRepositoryInput } from '@/lib/validation/entities'

const page = readFileSync(resolve(process.cwd(), 'src/app/(pm)/repositories/page.jsx'), 'utf8')

describe('Repositories page — Register repository sends businessId', () => {
  it('reads the active business from the trusted shell scope', () => {
    expect(page).toContain("import { useScope } from '@/context/ScopeContext'")
    expect(page).toContain('const scope = useScope()')
    expect(page).toContain('scope.shell.activeBusinessId')
  })

  it('includes businessId in the POST body that creates a Repository', () => {
    const postCallStart = page.indexOf("api('/api/repositories', { method: 'POST'")
    expect(postCallStart).toBeGreaterThan(-1)
    const postCall = page.slice(postCallStart, postCallStart + 120)
    expect(postCall).toContain('businessId')
  })

  it('never gives the user a free-text field to type a business id into', () => {
    // No form-state setter bound to a `businessId` key, and no bare input
    // named businessId — the value must come only from the shell prop.
    expect(page).not.toMatch(/set\(\s*['"]businessId['"]/)
    expect(page).not.toMatch(/name=["']businessId["']/)
    expect(page).not.toMatch(/<input[^>]*businessId/)
  })

  it('refuses to submit rather than send a request the server will reject, when no business is active', () => {
    expect(page).toContain('missingBusiness')
    expect(page).toMatch(/disabled=\{missingBusiness\}/)
    expect(page).toContain('No active business selected')
  })

  it('PATCH (editing an existing repository) is left untouched — it never needed businessId', () => {
    const patchCallStart = page.indexOf("api(`/api/repositories/${repo.id}`")
    expect(patchCallStart).toBeGreaterThan(-1)
    const patchCall = page.slice(patchCallStart, patchCallStart + 80)
    expect(patchCall).not.toContain('businessId')
  })

  // Regression pin: reproduces the exact reported symptom against the real
  // schema. Before the fix this test documents what every create attempt hit;
  // after the fix, RepoModal's body always carries businessId when creating,
  // so this shape can never reach the server again.
  it('a create body without businessId is exactly what the server rejects — "businessId: Required"', () => {
    const bodyRepoModalUsedToSend = {
      provider: 'github',
      fullName: 'org/repo',
      ownerName: 'org',
      repoName: 'repo',
      url: null,
      defaultBranch: 'main',
      externalRepoId: null,
    }
    expect(() => zRepositoryInput.parse(bodyRepoModalUsedToSend)).toThrow(/businessId/)
  })

  it('the same body with businessId attached — what the fixed page now sends — validates', () => {
    const bodyRepoModalNowSends = {
      provider: 'github',
      fullName: 'org/repo',
      ownerName: 'org',
      repoName: 'repo',
      url: null,
      defaultBranch: 'main',
      externalRepoId: null,
      businessId: 'business-id-from-active-shell-scope',
    }
    expect(() => zRepositoryInput.parse(bodyRepoModalNowSends)).not.toThrow()
  })
})

describe('Repositories page — list scoped to the active business (FR-073, BR-001)', () => {
  // /api/repositories returns every Repository the viewer may SEE
  // (repository-service.listRepositories filters with seesBusiness), which
  // spans every Business a multi-business viewer sees — not just the one
  // active in the shell. There is no businessId query param the page could
  // ask the server to filter by. Business scope is an authorization boundary
  // in this product (FR-059, FR-073, BR-001), so the page narrows what it
  // displays to the active business rather than mixing every visible
  // business's repositories into one undifferentiated list.
  it('filters the fetched list down to the active business before rendering', () => {
    expect(page).toContain('const scopedRepos = (data || []).filter((r) => r.businessId === businessId)')
  })

  it('renders and empty-states off the scoped list, not the raw fetch result', () => {
    expect(page).toContain('scopedRepos.length === 0')
    expect(page).toContain('scopedRepos.map((r) =>')
    // The raw, unscoped fetch result must not be what reaches the grid.
    expect(page).not.toMatch(/\(data \|\| \[\]\)\.map\(\(r\)/)
  })
})
