// @req FR-058 - File Manager view switcher: grid/timeline/by-project/preview
// over the same FR-045 managed asset set.
// @spec SDD-031, SEC-007
// @tested tests/e2e/fr058-file-views.spec.js
const { test, expect } = require('@playwright/test')
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

async function chooseBusiness(page) {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/overview/)
}

// T4 — Business 01 is the only Business the demo viewer can see/reach (seed.js
// grants no membership for BUS-002..004), and it is the same Business every
// other e2e spec asserts against, so there is no free Business to redirect to.
// Isolation instead comes from giving every artifact this file creates a name
// unique to the running test attempt (fresh on every retry, since this runs
// inside the test body) and asserting only on those named artifacts — never on
// a total/"first" count that a concurrently-running spec, or a retry of this
// same test re-adding its own fixtures on top of a first failed attempt, could
// perturb. See fr058-file-views.spec.js and fr059-strategy-edit.spec.js.
function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function addExternalFile(page, url) {
  await page.getByRole('button', { name: 'Add file' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add managed file' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('HTTPS URL').fill(url)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('FR-058 File Manager view switcher', () => {
  test('switches grid, timeline, by-project and preview over the same managed files', async ({ page }) => {
    // T4 — unique per attempt: a retry of this test (playwright.config.js sets
    // retries: 1) re-runs this whole body, so a fresh suffix here means the
    // retry's own two files never collide in name, or in count, with the
    // still-present files a failed first attempt already created.
    const suffix = uniqueSuffix()
    const reportName = `fr058-report-${suffix}.pdf`
    const diagramName = `fr058-diagram-${suffix}.png`
    const reportUrl = `https://example.test/fr058/${reportName}`
    const diagramUrl = `https://example.test/fr058/${diagramName}`

    await chooseBusiness(page)
    // FR-060 — landing is Business Home; Files is a Development sub-domain.
    await page.getByRole('link', { name: 'Development' }).first().click()
    await expect(page).toHaveURL(/\/projects$/)
    await page.getByRole('link', { name: 'Files', exact: true }).click()
    await expect(page).toHaveURL(/\/files$/)

    // No new route/persistence — the switcher only appears once there is something to switch over.
    await addExternalFile(page, reportUrl)
    await addExternalFile(page, diagramUrl)

    const switcher = page.getByRole('group', { name: 'File view' })
    await expect(switcher).toBeVisible()
    const gridButton = switcher.getByRole('button', { name: 'Grid' })
    const timelineButton = switcher.getByRole('button', { name: 'Timeline' })
    const byProjectButton = switcher.getByRole('button', { name: 'By project' })
    const previewButton = switcher.getByRole('button', { name: 'Preview' })

    // Grid is the default, unchanged behaviour.
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(reportName)).toBeVisible()
    await expect(page.getByText(diagramName)).toBeVisible()

    // Keyboard reachability (NFR-004): Tab to the Timeline control and activate with Enter.
    await gridButton.focus()
    await page.keyboard.press('Tab')
    await expect(timelineButton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(timelineButton).toHaveAttribute('aria-pressed', 'true')
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText(reportName)).toBeVisible()
    await expect(page.getByText(diagramName)).toBeVisible()

    // By project: both files were added at Business scope (no project), so they land
    // in the read model's BUSINESS group, surfaced here as "No project". T4: asserted
    // by locating that specific group's own container (via its heading, which is the
    // group `<p>`'s parent — see FileManagerViews.jsx's ByProjectView, heading and
    // asset grid are siblings) and checking our two uniquely-named files are inside
    // it, rather than a fixed "· 2" total the read model computes business-wide —
    // that total also includes any file any other concurrently-running spec (or a
    // duplicate-adding retry of this very test) has added at Business scope.
    await byProjectButton.click()
    await expect(byProjectButton).toHaveAttribute('aria-pressed', 'true')
    const noProjectHeading = page.getByText(/^No project · \d+$/)
    await expect(noProjectHeading).toBeVisible()
    const noProjectGroup = noProjectHeading.locator('xpath=..')
    await expect(noProjectGroup.getByText(reportName)).toBeVisible()
    await expect(noProjectGroup.getByText(diagramName)).toBeVisible()

    // Preview: EXTERNAL_URL assets are always a link-out, never proxied through
    // /api/files/{id}/content. T4: asserted by exact href match for each of our two
    // files (stronger than the old prefix-regex-on-just-the-first-link check) rather
    // than a total link count, which is exact-count-fragile the same way the
    // by-project total is.
    await previewButton.click()
    await expect(previewButton).toHaveAttribute('aria-pressed', 'true')
    const openLinkHrefs = await page.getByRole('link', { name: 'Open link' }).evaluateAll(
      (links) => links.map((link) => link.getAttribute('href')),
    )
    expect(openLinkHrefs).toContain(reportUrl)
    expect(openLinkHrefs).toContain(diagramUrl)

    // Only one view is active at a time.
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false')
    await expect(timelineButton).toHaveAttribute('aria-pressed', 'false')
    await expect(byProjectButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('By project labels a PROJECT group with the project\'s real code, never a raw uuid', async ({ page }) => {
    // T4 — unique per attempt, same reasoning as the sibling test above.
    const fileName = `fr058-project-scoped-${uniqueSuffix()}.pdf`

    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    const projectId = resolved.id

    // A file added from the Project's own File Manager is project-scoped —
    // this is what previously produced a PROJECT group in the by-project view.
    await page.goto(`/projects/${projectId}/files`)
    await addExternalFile(page, `https://example.test/fr058/${fileName}`)

    const switcher = page.getByRole('group', { name: 'File view' })
    await expect(switcher).toBeVisible()
    await switcher.getByRole('button', { name: 'By project' }).click()
    await expect(switcher.getByRole('button', { name: 'By project' })).toHaveAttribute('aria-pressed', 'true')

    // The group heading must show the project's human code AND name (wired end-to-end
    // through listManagedFileAssets' Prisma `select` in file-asset-service.js, which now
    // carries `name` alongside `code`). Matched against the full "code · name" heading so
    // this targets the group heading specifically, not the page's breadcrumb/eyebrow
    // (which shows the bare code with no separator). This is a substring match against
    // free text so it survives the group's own "· N" asset count, whatever N is.
    await expect(page.getByText('PRJ-B01-TRANSFORM · Business 01 Transformation Program')).toBeVisible()
    // T4: also prove it is specifically our just-added file that landed in that group.
    await expect(page.getByText(fileName)).toBeVisible()
    // ...and must never render the raw project uuid anywhere on the page — a test that
    // only checked for the good string would still pass if both were rendered.
    await expect(page.getByText(projectId, { exact: false })).toHaveCount(0)
  })
})
