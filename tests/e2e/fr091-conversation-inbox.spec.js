// @req FR-091 — the CRM Inbox is reachable, renders what the LINE ingress wrote, and
// offers no way to reply.
// @req FR-103 — the owner attestation control actually records consent, end to end.
// @spec SDD-050, SDD-053, BR-001, BR-011, SEC-005
// @tested tests/e2e/fr091-conversation-inbox.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

/**
 * Put a conversation in the tenant the way production does: through the webhook.
 *
 * Inserting rows would be faster and would prove less. What this page has to be right
 * about is the shape the ingest seam actually writes, so the fixture goes through it.
 *
 * The webhook is a batch: it answers 200 for a *received* batch and reports each
 * event's own outcome in `results[]` — an event can be `ok: false` inside a 200.
 * Asserting only `response.ok()` therefore proves nothing about the row this
 * fixture exists to create, and that gap was load-bearing: on 2026-08-26 the
 * consent test spent a full 45s pressing รีเฟรช on a conversation whose ingest
 * event had failed transiently inside a 200, invisible to the fixture. The event
 * write is atomic (one $transaction), so re-sending the same webhookEventId
 * after a failed attempt is clean; this is fixture SETUP being retried, never
 * the assertion the test measures.
 */
async function ingest(page, { thread, userId, displayName, messages }) {
  const scope = await (await page.request.get('/api/scope')).json()
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
    // A persistent failure now reports its actual stage and error instead of
    // surfacing later as a mystery row-timeout in the inbox.
    expect(outcome?.ok, `webhook event ${id} failed: ${JSON.stringify(outcome)}`).toBe(true)
  }
  return { displayName, last: messages[messages.length - 1] }
}

test.describe('FR-091 CRM Conversation Inbox', () => {
  /**
   * The inbox states its own contract on screen: it does not update itself —
   * "กด รีเฟรช เพื่อดูข้อความใหม่". Under full-suite CI load the page's one fetch
   * can land while this test's just-ingested conversation is not yet readable
   * (or fail transiently and render ErrorState, which has no rows at all), and
   * nothing on the page ever re-asks. A real user follows the page's own
   * instruction and presses refresh; so does this helper — bounded, and only
   * after the row demonstrably is not there. (The consent test flaked exactly
   * this way on the 2026-08-26 main-push run and twice on PR #112's run; the
   * original webhook test flaked the same way an hour later on PR #116's own
   * first run — same page, same single fetch, so every row-wait goes through
   * this helper now.)
   */
  async function waitForConversationRow(page, displayName) {
    const row = page.getByRole('listitem').filter({ hasText: displayName }).first()
    await expect(async () => {
      if (!(await row.isVisible())) {
        const refresh = page.getByRole('button', { name: 'รีเฟรช' })
        const retry = page.getByRole('button', { name: 'Retry' })
        if (await refresh.isVisible()) await refresh.click()
        else if (await retry.isVisible()) await retry.click()
      }
      await expect(row).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 45000 })
    return row
  }

  async function openConversationRow(page, displayName) {
    const row = await waitForConversationRow(page, displayName)
    await row.getByRole('button').click()
    return row
  }

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

    const row = await waitForConversationRow(page, sent.displayName)
    await expect(row).toContainText(sent.last)
    await expect(row).toContainText('2 ข้อความ')

    // Opening the row shows the thread oldest-first — the order a conversation reads in.
    await row.getByRole('button').click()
    const thread = page.locator('.card').filter({ hasText: 'BR-011' })
    await expect(thread).toContainText('สวัสดีครับ ขอราคาหน่อย')
    await expect(thread).toContainText('เอา 10 ชุดครับ')
  })

  test('the owner attests PDPA consent, and it persists across a reload (FR-103)', async ({ page }) => {
    await chooseBusiness(page)
    const sent = await ingest(page, {
      thread: 'e2e-consent',
      userId: 'Ue2e-consent',
      displayName: 'ลูกค้ายินยอม',
      messages: ['ขอสอบถามครับ'],
    })

    await page.goto('/customer/conversations')
    await openConversationRow(page, sent.displayName)

    const thread = page.locator('.card').filter({ hasText: 'BR-011' })
    // A brand new Customer starts PENDING, so the attestation buttons are visible.
    await expect(thread.getByText('PENDING', { exact: true })).toBeVisible()
    await thread.getByRole('button', { name: 'ลูกค้ายินยอมแล้ว' }).click()

    // The button becomes unavailable the moment status leaves PENDING — proves the
    // write round-tripped through the API and the panel re-read it (onRecorded).
    await expect(thread.getByText('GRANTED', { exact: true })).toBeVisible()
    await expect(thread.getByRole('button', { name: 'ลูกค้ายินยอมแล้ว' })).toHaveCount(0)

    // Persisted, not just local state: a fresh load of the same conversation still
    // shows GRANTED.
    await page.reload()
    await openConversationRow(page, sent.displayName)
    await expect(page.locator('.card').filter({ hasText: 'BR-011' }).getByText('GRANTED', { exact: true })).toBeVisible()
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
    // Scoped to the sidebar's own landmark (Sidebar.jsx: `aria-label="${domain.label}
    // sections"`), not to the whole page. The Dashboard card on this same page carries
    // a link whose accessible name is "เปิด Inbox" ("open Inbox") — a distinct label
    // for a distinct purpose (a call-to-action, not a second nav entry), but one that
    // contains "Inbox" as a substring, which is all Playwright's default `name` match
    // needs to collide once the card has rendered. That is a different situation from
    // the 'Schedule' collision documented in src/config/domains.js above the
    // Development sub-domain list — there, two *navigation* entries carried the
    // identical label on screen at once, which is ambiguous to a human too, so the
    // repo's answer was to change the copy. Here the two labels ("Inbox" vs. "เปิด
    // Inbox") are already distinct to a person and to a screen reader; the collision is
    // a locator-precision problem, not a copy problem, so the fix is to name which one
    // this test means — the same landmark-scoping already used by
    // fr040-project-work.spec.js and fr060-business-home.spec.js for the analogous case.
    const sidebar = page.getByRole('navigation', { name: 'CRM sections' })
    await expect(sidebar.getByRole('link', { name: 'Inbox' })).toBeVisible()
    await sidebar.getByRole('link', { name: 'Inbox' }).click()
    await expect(page).toHaveURL(/\/customer\/conversations/)
  })

  test('the endpoint refuses a Business outside the viewer scope', async ({ page }) => {
    await chooseBusiness(page)
    const response = await page.request.get('/api/crm/conversations?businessId=not-a-business')
    expect(response.status()).toBe(403)
  })
})
