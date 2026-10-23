// @req FR-271, FR-268 — optional-date SMART feedback, persisted HTTP writes,
// delayed refusal/focus and stale modal responses on the owned seeded target.
// @spec ADR-101 D3, NFR-004
// @tested tests/e2e/fr271-smart-feedback.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

async function arrange(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  const title = `SMART ${Date.now()}-${Math.random().toString(36).slice(2)}`
  await page.getByTestId('strategy-horizon-short').getByRole('button', { name: 'New goal' }).click()
  const form = page.getByRole('dialog', { name: 'Create Goal' })
  await form.getByLabel('Title').fill(title)
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/business/goals' && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  const goalResponse = await response
  expect(goalResponse.status()).toBe(200)
  const goal = await goalResponse.json()
  const card = page.getByTestId(`strategy-goal-${goal.code}`)
  await expect(card).toBeVisible()
  const open = async () => {
    await card.getByRole('button', { name: 'Key Result', exact: true }).click()
    return page.getByRole('dialog', { name: `New Key Result · ${goal.code}` })
  }
  return { goal, card, open }
}
async function fill(form, title) {
  await form.getByLabel('Title', { exact: true }).fill(title)
  await form.getByLabel('Metric', { exact: true }).fill('Closed deals')
  await form.getByLabel('Unit', { exact: true }).fill('deals')
  await form.getByLabel('Target', { exact: true }).fill('12')
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('SMART optional date and Specific warning save through actual API and survive reload', async ({ page }) => {
  const { goal, card, open } = await arrange(page)
  const form = await open()
  await fill(form, goal.title)
  await expect(form.getByText('Due date is optional; Time-bound remains unchecked without one.')).toBeVisible()
  await expect(form.getByText('Use a title distinct from the Goal for a more specific result.')).toBeVisible()
  const response = page.waitForResponse(r => r.url().includes(`/goals/${goal.id}/key-results`) && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  const saved = await response
  expect(saved.status()).toBe(200)
  const result = await saved.json()
  expect(result.smartChecks).toEqual({ specific: false, measurable: true, timeBound: false, achievable: null, relevant: null })
  expect(result.dueAt).toBeNull()
  await expect(form).toBeHidden()
  await page.reload()
  await expect(card.getByTestId(`strategy-kr-${result.code}`)).toBeVisible()
})

test('delayed refusal preserves current fields and focus', async ({ page }) => {
  const { goal, open } = await arrange(page)
  const gate = deferred(), received = deferred()
  await page.route(`**/api/business/goals/${goal.id}/key-results`, async route => {
    received.resolve(); await gate.promise
    await route.fulfill({ status: 403, json: { error: 'Owner permission was revoked' } })
  })
  try {
    const form = await open()
    await fill(form, 'Keep this draft')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await received.promise
    await form.getByLabel('Unit', { exact: true }).fill('retained unit')
    gate.resolve()
    await expect(form.getByText('Owner permission was revoked')).toBeVisible()
    await expect(form.getByLabel('Unit', { exact: true })).toHaveValue('retained unit')
    await expect(form.getByLabel('Unit', { exact: true })).toBeFocused()
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Keep this draft')
  } finally { gate.resolve() }
})

test('a stale successful response cannot close the replacement draft modal', async ({ page }) => {
  const { goal, open } = await arrange(page)
  const gate = deferred(), received = deferred()
  await page.route(`**/api/business/goals/${goal.id}/key-results`, async route => {
    received.resolve(); await gate.promise
    await route.fulfill({ status: 200, json: { id: 'synthetic-stale-success' } })
  })
  try {
    let form = await open()
    await fill(form, 'Discarded request')
    const response = page.waitForResponse(r => r.url().includes(`/goals/${goal.id}/key-results`) && r.request().method() === 'POST')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await received.promise
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    form = await open()
    await form.getByLabel('Title', { exact: true }).fill('Replacement draft')
    gate.resolve()
    await (await response).finished()
    // Let the fulfilled fetch's microtasks and React commit complete, not an
    // arbitrary sleep that can accidentally precede the old onClose callback.
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Replacement draft')
  } finally { gate.resolve() }
})
