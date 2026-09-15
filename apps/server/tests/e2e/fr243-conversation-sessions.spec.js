// @req FR-243 — conversation sessions are visible where people read chats: messages
//   sent close together share one session, a message after a gap longer than the
//   account's idle timeout starts another, and the Inbox draws one divider per
//   session with its code (ADR-094 D2, D4; TASK-ZAI-107).
// @spec ADR-094, SDD-102
// @tested tests/e2e/fr243-conversation-sessions.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

const MINUTE = 60_000

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

/**
 * Through the webhook, as production writes it. Each message carries LINE's own
 * `timestamp`, which is what decides its session (SDD-102): two messages two minutes
 * apart and a third two hours later must land in two sessions whatever time the
 * requests themselves reach the server.
 */
async function ingest(page, { userId, displayName, messages }) {
  const scope = await readScope(page.request)
  const business = scope.businesses.find((item) => item.code === 'BUS-001')
  const stamp = Date.now()
  for (const [index, { text, at }] of messages.entries()) {
    const id = `e2e-session-${stamp}-${index}`
    let outcome
    for (let attempt = 0; attempt < 3 && !outcome?.ok; attempt++) {
      if (attempt > 0) await page.waitForTimeout(300 * attempt)
      const response = await page.request.post('/api/agent/line-webhook', {
        data: {
          tenantId: business.tenantId,
          businessId: business.id,
          displayName,
          events: [{
            webhookEventId: id,
            type: 'message',
            source: { userId: `${userId}-${stamp}` },
            message: { id, type: 'text', text },
            timestamp: at,
          }],
        },
      })
      expect(response.ok()).toBe(true)
      outcome = (await response.json()).results?.[0]
    }
    expect(outcome?.ok, `webhook event ${id} failed: ${JSON.stringify(outcome)}`).toBe(true)
  }
}

test.describe('FR-243 conversation sessions', () => {
  test('a gap past the idle timeout starts a new session, and the Inbox shows one divider per session', async ({ page }) => {
    await chooseBusiness(page)
    const now = Date.now()
    const displayName = `ลูกค้าหลาย session ${now}`
    await ingest(page, {
      userId: 'Ue2e-sessions',
      displayName,
      messages: [
        { text: 'สวัสดีครับ ขอราคาแก้วหน่อย', at: now - 180 * MINUTE },
        { text: 'เอา 20 ใบครับ', at: now - 178 * MINUTE },
        { text: 'กลับมาถามอีกรอบ ส่งวันไหนได้ครับ', at: now - 60 * MINUTE },
      ],
    })

    await page.goto('/customer/conversations')
    const row = page.getByRole('listitem').filter({ hasText: displayName }).first()
    await expect(async () => {
      if (!(await row.isVisible())) {
        const refresh = page.getByRole('button', { name: 'รีเฟรช' })
        if (await refresh.isVisible()) await refresh.click()
      }
      await expect(row).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 45000 })
    await row.getByRole('button').click()

    const thread = page.locator('.card').filter({ hasText: 'BR-011' })
    await expect(thread).toContainText('กลับมาถามอีกรอบ ส่งวันไหนได้ครับ')
    const dividers = thread.getByRole('separator')
    await expect(dividers).toHaveCount(2)
    const codes = await dividers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-session-code')))
    expect(codes).toHaveLength(2)
    for (const code of codes) expect(code).toMatch(/^S-\d{8}-[0-9A-Z]{6}$/)
    expect(codes[0]).not.toBe(codes[1])
  })
})
