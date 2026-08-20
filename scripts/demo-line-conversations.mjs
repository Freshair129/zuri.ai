#!/usr/bin/env node
// @req FR-091 — demo data for the CRM Conversation Inbox.
// @spec BR-009, SDD-009 — an intake surface has one write path, so this script does
//   NOT insert Customer/Conversation/Message rows. It POSTs to the real LINE webhook
//   and lets the real ingest seam write them.
//
// WHY IT DRIVES THE WEBHOOK INSTEAD OF THE DATABASE
// ------------------------------------------------
// Seeding these tables directly would be four `prisma.create` calls and would work.
// It would also be a second writer of models the crm charter says have exactly one,
// and the demo would then prove that the *seed* can produce rows the inbox renders —
// which is not the question anyone is asking. Going through `POST /api/agent/line-webhook`
// means the screenshot is evidence about the shipping path: webhook → scope → raw
// evidence → identity → customer → conversation → message → the page.
//
// It only works where the webhook accepts a client-supplied scope, which is
// development and test only: `resolvePhase1RequestScope` closes that branch in
// production (SEC-010), so this script cannot be pointed at a production host and
// quietly work.
//
// It also plays the OTHER half of the transport's job (FR-092): after the webhook
// answers, it posts a delivery receipt for the reply it "sent". In the lab there is no
// model, so the stack produces no text and the script sends its own — which is exactly
// the `TRANSPORT_FALLBACK` case, marked as such rather than dressed up as an answer.
//
// Usage:
//   node scripts/demo-line-conversations.mjs [--base http://localhost:3000] [--business BUS-001]

import { PrismaClient } from '@prisma/client'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const BASE = (arg('base', 'http://localhost:3000') || '').replace(/\/+$/, '')
const BUSINESS_CODE = arg('business', 'BUS-001')

// Four customers with the kinds of thing a Thai SME actually gets on LINE: a price
// question, an order, a complaint and a first contact that goes nowhere. The last one
// exists so the inbox has a conversation with a single message — the row shape that
// breaks a "last message" join written carelessly.
const SCRIPTS = [
  {
    userId: 'Udemo-somchai',
    displayName: 'สมชาย',
    thread: 'demo-thread-somchai',
    messages: ['สวัสดีครับ ร้านเปิดกี่โมงครับ', 'ขอถามราคากระเช้าปีใหม่หน่อยครับ', 'เอา 20 ชุดได้ไหมครับ ส่งวันที่ 25'],
    replies: ['เปิด 9 โมงถึง 6 โมงเย็นครับ', 'กระเช้าปีใหม่เริ่มที่ 450 บาทครับ', 'ได้ครับ 20 ชุด ส่งวันที่ 25 ยืนยันได้เลย'],
  },
  {
    userId: 'Udemo-malee',
    displayName: 'มาลี',
    thread: 'demo-thread-malee',
    messages: ['สนใจสั่งของขวัญพนักงานค่ะ ประมาณ 150 ชิ้น', 'งบต่อชิ้นไม่เกิน 450 ค่ะ', 'มีแบบใส่โลโก้บริษัทได้ไหมคะ'],
    replies: ['ได้เลยค่ะ 150 ชิ้นมีส่วนลดขั้นบันได', 'ในงบ 450 มีให้เลือก 6 แบบค่ะ', 'ใส่โลโก้ได้ค่ะ ขั้นต่ำ 100 ชิ้น'],
  },
  {
    userId: 'Udemo-anan',
    displayName: 'อนันต์',
    thread: 'demo-thread-anan',
    messages: ['ของที่สั่งไปเมื่อวานยังไม่ได้รับเลยครับ', 'เลขพัสดุที่ให้มาเช็คไม่เจอครับ'],
    // Deliberately one reply short of the inbound count: the last message is still
    // unanswered, which is the state an inbox exists to make visible.
    replies: ['ขออภัยครับ ขอตรวจสอบให้สักครู่'],
  },
  {
    userId: 'Udemo-ploy',
    displayName: 'พลอย',
    thread: 'demo-thread-ploy',
    messages: ['สวัสดีค่ะ'],
    replies: [],
  },
]

const prisma = new PrismaClient()

/** Post one delivery receipt. Returns how many rows it claims to have recorded. */
async function reportDelivery(business, receipt) {
  const response = await fetch(`${BASE}/api/agent/line-delivery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': `demo-reply-${receipt.inboundMessageId}` },
    body: JSON.stringify({ tenantId: business.tenantId, businessId: business.id, deliveries: [receipt] }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`delivery ${response.status}: ${body?.error ?? 'unknown'}`)
  const failed = (body?.results || []).filter((item) => !item.ok)
  if (failed.length) throw new Error(`delivery receipt failed: ${failed.map((item) => item.error).join('; ')}`)
  return body.recorded
}

async function main() {
  const business = await prisma.business.findUnique({
    where: { code: BUSINESS_CODE },
    select: { id: true, tenantId: true, name: true, code: true },
  })
  if (!business) {
    throw new Error(`No Business with code ${BUSINESS_CODE}. Run \`npm run db:seed\` first.`)
  }

  console.log(`Sending demo LINE traffic to ${BASE} for ${business.code} (${business.name})`)

  const before = await prisma.message.count({ where: { direction: 'INBOUND' } })
  let posted = 0
  let reported = 0

  for (const script of SCRIPTS) {
    for (const [index, text] of script.messages.entries()) {
      // A stable id per message is what makes re-running this safe: the ingest seam is
      // idempotent on (conversation, externalMessageId), so a second run adds nothing.
      const externalMessageId = `${script.thread}-${index + 1}`
      const response = await fetch(`${BASE}/api/agent/line-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': `demo-${script.thread}-${index + 1}` },
        body: JSON.stringify({
          tenantId: business.tenantId,
          businessId: business.id,
          displayName: script.displayName,
          events: [{
            webhookEventId: externalMessageId,
            type: 'message',
            source: { userId: script.userId },
            message: { id: externalMessageId, type: 'text', text },
            timestamp: Date.now(),
          }],
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(`webhook ${response.status}: ${body?.error ?? 'unknown'}`)
      }
      const result = body?.results?.[0]
      if (result?.error) throw new Error(`event failed at stage ${result.stage}: ${result.error}`)
      posted += 1

      // The transport's other half (FR-092), reported immediately rather than batched
      // at the end — which is both what the runtime does (it replies per event) and
      // what makes the thread read as a conversation: batching every receipt until
      // last put all three customer messages above all three shop replies.
      //
      // A scripted reply stands in for what a shop would send. Where the stack
      // produced no text — every turn in a lab with no model configured — that is a
      // TRANSPORT_FALLBACK and is recorded as one. Dressing it up as `STACK` would
      // put a lie in the audit trail to make a demo look better.
      const reply = script.replies?.[index]
      if (reply && result?.inboundMessageId) {
        const sent = result.response?.text?.trim()
        reported += await reportDelivery(business, {
          inboundMessageId: result.inboundMessageId,
          text: sent || reply,
          source: sent ? 'STACK' : 'TRANSPORT_FALLBACK',
        })
      }
    }
  }

  // Counted from the database rather than from the response: the webhook reports what
  // it handled, and "handled" includes a redelivery the ingest seam correctly refused
  // to store twice. The row delta is the only honest measure of what this run added.
  //
  // Scoped to INBOUND, because the replies posted above land in the same table and
  // would otherwise be counted as inbound messages this run stored — an earlier
  // version printed "-7 were already present" for exactly that reason.
  const stored = (await prisma.message.count({ where: { direction: 'INBOUND' } })) - before
  const conversations = await prisma.conversation.count({ where: { tenantId: business.tenantId } })
  const outbound = await prisma.message.count({ where: { direction: 'OUTBOUND', conversation: { tenantId: business.tenantId } } })
  console.log(`Posted ${posted} event(s); ${stored} became new inbound row(s), ${posted - stored} were already present.`)
  console.log(`Reported ${reported} reply delivery receipt(s); tenant holds ${outbound} recorded repl${outbound === 1 ? 'y' : 'ies'}.`)
  console.log(`Tenant now holds ${conversations} conversation(s). Open ${BASE}/customer/conversations`)
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
