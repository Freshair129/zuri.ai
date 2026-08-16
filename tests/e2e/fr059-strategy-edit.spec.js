// @req FR-059 - OWNER-scoped Business Strategy editing: create a Goal under an
// existing horizon, link a Project to it, and see both reflected on Overview
// through the unchanged FR-041 read model.
// @spec BR-001, SDD-032
// @tested tests/e2e/fr059-strategy-edit.spec.js
const { test, expect } = require('@playwright/test')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

// T4 — Business 01 is the only Business the demo viewer can see/reach (seed.js
// grants no membership for BUS-002..004), and PRJ-B01-TRANSFORM is the only
// Project in it, so both are shared with every other e2e spec — there is no
// free Business/Project to redirect to. Isolation instead comes from giving
// every Goal this file creates a title unique to the running test attempt
// (fresh on every retry, since this runs inside the test body). Without this,
// a retry of a test that had already created "Ship the FR-059 e2e goal" before
// failing later would, on its next attempt, create a second Goal with the
// identical title — turning the `hasText`-scoped goalCard locator below into a
// two-element (ambiguous) match and hard-failing the retry too.
function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('FR-059 Business Strategy editing', () => {
  test('OWNER creates a Goal, links a Project, and sees it reflected on Overview', async ({ page }) => {
    await chooseBusiness(page)
    const goalTitle = `Ship the FR-059 e2e goal ${uniqueSuffix()}`

    const shortHorizon = page.getByTestId('strategy-horizon-short')
    await expect(shortHorizon).toBeVisible()

    // Create a Goal under the Short term horizon.
    await shortHorizon.getByRole('button', { name: 'New goal' }).click()
    const goalDialog = page.getByRole('dialog', { name: 'Create Goal' })
    await expect(goalDialog).toBeVisible()
    await goalDialog.getByLabel('Title').fill(goalTitle)
    await goalDialog.getByRole('button', { name: 'Save' }).click()
    await expect(goalDialog).toBeHidden()

    // The new Goal is reflected on Overview via the same FR-041 GET, nested
    // under the horizon it was created against.
    const goalCard = shortHorizon.locator('[data-testid^="strategy-goal-"]', { hasText: goalTitle })
    await expect(goalCard).toBeVisible()

    // Link the seeded Business 01 project to the new Goal.
    await goalCard.getByRole('button', { name: /link projects/i }).click()
    const linkDialog = page.getByRole('dialog', { name: /Link Projects/ })
    await expect(linkDialog).toBeVisible()
    await linkDialog.getByLabel('Link a project').selectOption({ label: 'PRJ-B01-TRANSFORM · Business 01 Transformation Program' })
    await linkDialog.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(linkDialog.getByText(/PRJ-B01-TRANSFORM/)).toBeVisible()
    await linkDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(linkDialog).toBeHidden()

    // Overview reflects the link without a second read path (FR-059 reuses
    // the FR-041 GET; no bespoke strategy-edit read model was added).
    await expect(goalCard.getByText('1 linked project')).toBeVisible()
  })

  test('Cancelling RoadmapModal discards the edit instead of persisting it on the next Save (T3b-1 FIX 3)', async ({ page }) => {
    await chooseBusiness(page)

    const editButton = page.getByRole('button', { name: 'Edit roadmap' })
    await editButton.click()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const titleField = dialog.getByLabel('Title')
    const originalTitle = await titleField.inputValue()

    // Type an edit, then Cancel — the pre-fix bug: RoadmapModal stayed
    // permanently mounted (only `open` toggled), so its `useState(() => ...)`
    // initializer never re-ran and the typed text survived a close/reopen.
    await titleField.fill(`${originalTitle} — DISCARD ME`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    await editButton.click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Title')).toHaveValue(originalTitle)

    // Saving from this freshly-reopened dialog must not resurrect the
    // discarded text either.
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(`${originalTitle} — DISCARD ME`)).toHaveCount(0)
  })

  test('focus stays trapped inside an open modal across a mutation reload (T3b-1 FIX 4)', async ({ page }) => {
    await chooseBusiness(page)
    const shortHorizon = page.getByTestId('strategy-horizon-short')
    const goalTitle = `FR-059 focus-trap e2e goal ${uniqueSuffix()}`

    // A brand-new Goal has no linked Projects yet, so the Link modal's
    // project select is guaranteed non-empty regardless of what an earlier
    // spec in this file already linked.
    await shortHorizon.getByRole('button', { name: 'New goal' }).click()
    const goalDialog = page.getByRole('dialog', { name: 'Create Goal' })
    await goalDialog.getByLabel('Title').fill(goalTitle)
    await goalDialog.getByRole('button', { name: 'Save' }).click()
    await expect(goalDialog).toBeHidden()

    const goalCard = shortHorizon.locator('[data-testid^="strategy-goal-"]', { hasText: goalTitle })
    await goalCard.getByRole('button', { name: /link projects/i }).click()
    const linkDialog = page.getByRole('dialog', { name: /Link Projects/ })
    await expect(linkDialog).toBeVisible()

    const select = linkDialog.getByLabel('Link a project')
    await expect(select).toBeFocused()

    await linkDialog.getByRole('button', { name: 'Link', exact: true }).click()
    // LinkProjectModal deliberately stays open across a link (see its header
    // comment) so an OWNER can work through several Projects in one sitting.
    await expect(linkDialog).toBeVisible()
    // The pre-fix regression: the focus-trap effect's deps were
    // [open, onClose], and page.jsx's onClose is a fresh inline arrow on
    // every parent render, so the reload() this mutation triggers tore the
    // effect down and rebuilt it — resetting focus outside the dialog
    // entirely (measured live: onto <body>) instead of leaving it alone.
    await expect(page.locator('body')).not.toBeFocused()
    await expect(linkDialog.locator(':focus')).toHaveCount(1)
  })
})
