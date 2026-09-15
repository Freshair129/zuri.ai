// @req FR-246 — a Business OWNER sends a reply from the CRM Inbox composer; the
//   server pushes it through the account's LINE transport and records it. This spec
//   proves the whole client -> route -> service chain wires together and fails
//   cleanly (never a crash, never a silent success) when the conversation's channel
//   has no server-enabled LINE OA account to push through — the shape every
//   conversation seeded through the legacy `/api/agent/line-webhook` fixture has,
//   so no real LINE API call is ever made by this spec.
// @spec ADR-093 evidence gap; BR-001; BR-011 (answers no replyToken, races nothing)
// @tested tests/e2e/fr246-staff-reply.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

/** Same fixture shape as fr091-conversation-inbox.spec.js's own `ingest()`. */
async function ingest(page, { thread, userId, displayName, messages }) {
  const scope = await readScope(page.request)
  const business = scope.businesses.find((item) => item.code === 'BUS-001')
  const stamp = Date.now()
  for (const [index, text] of messages.entries()) {
    const id = `${thread}-${stamp}-${index}`
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
            timestamp: Date.now(),
          }],
        },
      })
      expect(response.ok()).toBe(true)
      outcome = (await response.json()).results?.[0]
    }
    expect(outcome?.ok, `webhook event ${id} failed: ${JSON.stringify(outcome)}`).toBe(true)
  }
  return { displayName }
}

test.describe('FR-246 staff reply', () => {
  test('sending fails cleanly, with a visible error and no crash, for a conversation with no server-enabled LINE account', async ({ page }) => {
    await chooseBusiness(page)
    const sent = await ingest(page, {
      thread: 'e2e-staff-reply',
      userId: 'Ue2e-staff-reply',
      displayName: 'คุณทดสอบตอบพนักงาน',
      messages: ['สอบถามราคาครับ'],
    })

    await page.goto('/customer/conversations')
    const row = page.getByRole('listitem').filter({ hasText: sent.displayName }).first()
    await expect(async () => {
      if (!(await row.isVisible())) {
        const refresh = page.getByRole('button', { name: 'รีเฟรช' })
        if (await refresh.isVisible()) await refresh.click()
      }
      await expect(row).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 45000 })
    await row.getByRole('button').click()

    const thread = page.locator('.card').filter({ hasText: 'BR-011' })
    const textarea = thread.getByRole('textbox')
    await expect(textarea).toBeVisible()
    await textarea.fill('ขอบคุณที่ติดต่อมาครับ เดี๋ยวเช็คให้')
    await thread.getByRole('button', { name: 'ส่ง' }).click()

    // Refused before any push — the conversation's channel is the legacy fixture's,
    // which names no LineOaAccount at all.
    await expect(thread.getByRole('alert')).toBeVisible()
    // The typed text is not lost on a failed send, so the owner can retry or copy it.
    await expect(textarea).toHaveValue('ขอบคุณที่ติดต่อมาครับ เดี๋ยวเช็คให้')
    // And the page is still the same page — no crash, no navigation away.
    await expect(page).toHaveURL(/\/customer\/conversations/)
  })
})
