// @req FR-091 — the CRM Inbox is reachable, renders what the LINE ingress wrote, and
// offers no way to reply.
// @spec SDD-050, BR-001, BR-011
// @tested tests/e2e/fr091-conversation-inbox.spec.js
const { test, expect } = require('@playwright/test')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

/**
 * Put a conversation in the tenant the way production does: through the webhook.
 *
 * Inserting rows would be faster and would prove less. What this page has to be right
 * about is the shape the ingest seam actually writes, so the fixture goes through it.
 */
async function ingest(page, { thread, userId, displayName, messages }) {
  const scope = await (await page.request.get('/api/scope')).json()
  const business = scope.businesses.find((item) => item.code === 'BUS-001')
  const stamp = Date.now()

  for (const [index, text] of messages.entries()) {
    const id = `${thread}-${stamp}-${index}`
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
  }
  return { displayName, last: messages[messages.length - 1] }
}

test.describe('FR-091 CRM Conversation Inbox', () => {
  test('a message that arrived through the webhook is readable in the Inbox', async ({ page }) => {
    await chooseBusiness(page)
    const sent = await ingest(page, {
      thread: 'e2e-inbox',
      userId: 'Ue2e-inbox',
      displayName: 'ลูกค้าทดสอบ',
      messages: ['สวัสดีครับ ขอราคาหน่อย', 'เอา 10 ชุดครับ'],
    })

    await page.goto('/customer/conversations')
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()

    const row = page.getByRole('listitem').filter({ hasText: sent.displayName }).first()
    await expect(row).toContainText(sent.last)
    await expect(row).toContainText('2 ข้อความ')

    // Opening the row shows the thread oldest-first — the order a conversation reads in.
    await row.getByRole('button').click()
    const thread = page.locator('.card').filter({ hasText: 'BR-011' })
    await expect(thread).toContainText('สวัสดีครับ ขอราคาหน่อย')
    await expect(thread).toContainText('เอา 10 ชุดครับ')
  })

  test('offers no way to reply — the reply owner is the runtime that received the message', async ({ page }) => {
    await chooseBusiness(page)
    await ingest(page, {
      thread: 'e2e-noreply',
      userId: 'Ue2e-noreply',
      // Deliberately NOT a name containing the phrase asserted below: the first
      // version of this test named the customer 'ลูกค้าอ่านอย่างเดียว', which made
      // the locator match the row and the footer and fail on strict mode.
      displayName: 'คุณทดสอบไม่ตอบ',
      messages: ['ทดสอบครับ'],
    })

    await page.goto('/customer/conversations')
    // BR-011: a console that could reply would be a second reply owner racing a token
    // that expires in about thirty seconds.
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByText(/อ่านอย่างเดียว/)).toBeVisible()
  })

  test('the CRM Dashboard reconciles with the list one click away', async ({ page }) => {
    await chooseBusiness(page)
    await ingest(page, {
      thread: 'e2e-dash',
      userId: 'Ue2e-dash',
      displayName: 'ลูกค้าแดชบอร์ด',
      messages: ['หนึ่ง', 'สอง', 'สาม'],
    })

    await page.goto('/customer')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    const inbox = await (await page.request.get(
      `/api/crm/conversations?businessId=${(await (await page.request.get('/api/scope')).json()).businesses.find((b) => b.code === 'BUS-001').id}`,
    )).json()

    // The band is not a second count of its own: every figure comes from this response.
    await expect(page.getByText(String(inbox.counts.conversations), { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /เปิด Inbox/ })).toBeVisible()
  })

  test('the CRM domain is navigable rather than a reserved slot', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/customer')
    const inboxLink = page.getByLabel('Inbox')
    await expect(inboxLink).toBeVisible()
    await inboxLink.click()
    await expect(page).toHaveURL(/\/customer\/conversations/)
  })

  test('the endpoint refuses a Business outside the viewer scope', async ({ page }) => {
    await chooseBusiness(page)
    const response = await page.request.get('/api/crm/conversations?businessId=not-a-business')
    expect(response.status()).toBe(403)
  })
})
