const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')

const createdNames = []
test.afterEach(async () => {
  // Test-owned fixture only; the rich menus go with their account.
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  try {
    const names = createdNames.splice(0)
    const accounts = await db.lineOaAccount.findMany({ where: { connection: { name: { in: names } } }, select: { id: true } })
    const accountIds = accounts.map((account) => account.id)
    await db.lineOaRichMenuVersion.deleteMany({ where: { richMenu: { lineOaAccountId: { in: accountIds } } } })
    await db.lineOaRichMenu.deleteMany({ where: { lineOaAccountId: { in: accountIds } } })
    await db.lineOaAccount.deleteMany({ where: { connection: { name: { in: names } } } })
    await db.integrationConnection.deleteMany({ where: { name: { in: names } } })
  }
  finally { await db.$disconnect() }
})

// @req FR-151 — an owner authors a rich menu in the real console: the draft
//   persists, the version list shows what still blocks a freeze, and Freeze
//   stays disabled until it does not.
// @spec ADR-060 D3, D11
// @tested tests/e2e/fr151-line-oa-rich-menu-console.spec.js

test('authoring a rich menu persists it and freezing waits on the image the service asks for', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)

  // A rich menu belongs to an account, so make one the same way FR-149 does.
  const tag = `rm-e2e-${Date.now()}`
  createdNames.push(tag)
  // FR-149's console is a tab of LINE Studio Enterprise now
  // (LineStudioEdgeConnection). `/line-oa` reads `?tab=` straight into the
  // shell's initial tab, so the URL selects it — and survives the reload below,
  // which a click on a tab control would not.
  await page.goto('/line-oa?tab=edge-connection')
  // One submit provisions the connection and the account together now (see
  // FR-149's spec): the display name names both, so the cleanup above still
  // finds the connection by it.
  await page.getByLabel(/ชื่อบัญชี LINE OA \(Display Name\)/).fill(tag)
  await page.getByRole('button', { name: 'เชื่อมต่อ LINE Official Account ทันที', exact: true }).click()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()

  await page.goto('/line-oa/rich-menus')
  await expect(page.getByRole('heading', { name: 'Rich Menu' })).toBeVisible()
  await expect(page.getByLabel('บัญชี LINE OA', { exact: true })).toBeVisible()
  await expect(page.getByText('ยังไม่มีเมนูสำหรับบัญชีนี้', { exact: true })).toBeVisible()

  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/line-oa/rich-menus'))
  await page.getByLabel('รหัสเมนู', { exact: true }).fill(tag)
  await page.getByLabel('ชื่อเมนู', { exact: true }).fill(`${tag} menu`)
  await page.getByLabel('ข้อความบนแถบแชท', { exact: true }).fill('เมนู')
  // The default layout is one cell, and its MESSAGE action needs its text:
  // zRichMenuDraft requires it, so the form requires it too and the browser
  // refuses to submit without it.
  await page.getByLabel('ข้อความที่ส่งแทนผู้ใช้', { exact: true }).fill('สวัสดี')
  await page.getByRole('button', { name: 'สร้างเมนูพร้อมฉบับร่างแรก', exact: true }).click()
  expect((await created).ok()).toBe(true)
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  // It survives a reload, which is the only proof the row exists rather than
  // the form having cleared itself.
  await page.reload()
  await expect(page.getByRole('heading', { name: `${tag} menu`, exact: true })).toBeVisible()
  const card = page.getByRole('heading', { name: `${tag} menu`, exact: true }).locator('xpath=../../..')
  await expect(card.getByText('v1', { exact: true })).toBeVisible()

  // The service computes the blockers; the page shows them and gates on them.
  await expect(card.getByText('Freeze ยังไม่ได้เพราะ', { exact: true })).toBeVisible()
  // The blocker is shown twice on purpose: once against the version it belongs
  // to, once as the reason the Freeze button is off. A disabled control with no
  // stated reason is the thing worth avoiding here.
  await expect(card.getByText(/image FileAsset/i)).toHaveCount(2)
  await expect(card.getByText(/image FileAsset/i).first()).toBeVisible()
  await expect(card.getByRole('button', { name: 'Freeze ฉบับร่างนี้', exact: true })).toBeDisabled()

  // No control claims the menu reaches LINE, and the page says why.
  await expect(page.getByText(/ไม่ใช่การส่งขึ้น LINE/)).toBeVisible()
  await expect(page.getByText(/คิวงานแยก \(FR-152\)/)).toBeVisible()

  // FR-152 — the publish lane is present, and every one of its buttons is off
  // with the service's own reason next to it: this account has not enabled
  // Server transport, so nothing here can be queued yet.
  await expect(card.getByText('งานส่งขึ้น LINE', { exact: true })).toBeVisible()
  await expect(card.getByText(/งานถูกเข้าคิวไว้ให้ worker ทำ ไม่ได้ทำทันทีที่กด/)).toBeVisible()
  await expect(card.getByText('ยังไม่มีงานสำหรับเมนูนี้', { exact: true })).toBeVisible()
  for (const label of ['ส่งขึ้น LINE', 'ตั้งเป็นเมนูหลัก', 'ผูก alias']) {
    await expect(card.getByRole('button', { name: label, exact: true })).toBeDisabled()
  }
  // The blocker the service reports first is the account's, not the draft's:
  // this account has not enabled Server transport, because creating one no
  // longer does it on the operator's behalf (FR-149). main asserts the freeze
  // blocker here instead, which is only what you see once the account is
  // already live.
  await expect(card.getByText(/บัญชีนี้ยังไม่ได้เปิด Server transport/).first()).toBeVisible()
})
