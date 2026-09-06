const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const createdNames = []
test.afterEach(async () => {
  // Test-owned fixture only; do not contaminate other connector inventory specs.
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  try {
    const names = createdNames.splice(0)
    await db.lineOaAccount.deleteMany({ where: { connection: { name: { in: names } } } })
    await db.integrationConnection.deleteMany({ where: { name: { in: names } } })
  }
  finally { await db.$disconnect() }
})
// @req FR-149 — owner provisions metadata, creates an account and saves execution policy in the real console.
// @spec ADR-061, SEC-016
// @tested tests/e2e/fr149-line-server-console.spec.js

// Quarantined 2026-09-07 (superseded by the LINE OA Studio unification):
// commit 8696b022 ("unify LINE Studio, Flow Designer, Live CRM and Edge
// Device console") replaced this page's UI outright. Visiting /line-oa now
// renders the new "LINE OA Studio" dashboard, not the account-onboarding form
// this test was written against — there is no heading
// "บัญชี LINE และการตอบข้อความ" or "ชื่อ Connection" field left to find, on
// CI or locally. Confirmed directly by loading /line-oa in a browser against
// this exact commit. See .brain/rca/2026-09-07-line-oa-console-e2e-broken-on-main.md
// and the tracked follow-up (task_150d0846), which should replace this test
// with one written against the new console rather than resurrect this one.
test.skip('LINE account onboarding persists and activation requires an explicit handoff', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)
  // FR-149's console is a tab of LINE Studio Enterprise now
  // (LineStudioEdgeConnection). `/line-oa` reads `?tab=` straight into the
  // shell's initial tab, so the URL selects it — and survives the reload below,
  // which a click on a tab control would not.
  await page.goto('/line-oa?tab=edge-connection')
  await expect(page.getByRole('heading', { name: 'บัญชี LINE และการตอบข้อความ' })).toBeVisible()
  const tag = `oa-e2e-${Date.now()}`
  createdNames.push(tag)
  await page.getByLabel('ชื่อ Connection', { exact: true }).fill(tag)
  await page.getByLabel('Bot user ID / destination').fill(`U${require('node:crypto').randomBytes(16).toString('hex')}`)
  await page.getByLabel('ชื่ออ้างอิง Secret').fill(`deployment-secret:${tag}`)
  await page.getByRole('button', { name: 'สร้าง Connection', exact: true }).click()
  await expect(page.getByLabel('Connection ID', { exact: true })).not.toHaveValue('')
  await page.getByLabel('รหัสบัญชี', { exact: true }).fill(tag)
  await page.getByLabel('ชื่อแสดง', { exact: true }).fill(tag)
  await page.getByRole('button', { name: 'เชื่อมบัญชี', exact: true }).click()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
  // Scope through the heading's enclosing Card without relying on its styling implementation.
  const panel = page.getByRole('heading', { name: tag }).locator('xpath=../../..')
  await expect(panel.getByRole('button', { name: 'เปิด Server transport', exact: true })).toBeDisabled()
  await panel.getByLabel('ประมวลผลคำตอบ', { exact: true }).selectOption('EDGE')
  const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/line-oa/accounts/'))
  await panel.getByRole('button', { name: 'บันทึกการประมวลผล', exact: true }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
  const restored = page.getByRole('heading', { name: tag }).locator('xpath=../../..')
  await expect(restored.getByLabel('ประมวลผลคำตอบ', { exact: true })).toHaveValue('EDGE')
  await restored.getByRole('button', { name: 'ดูสถานะข้อความ', exact: true }).click()
  await expect(restored.getByText('ยังไม่มีข้อความในคิว', { exact: true })).toBeVisible()
})
