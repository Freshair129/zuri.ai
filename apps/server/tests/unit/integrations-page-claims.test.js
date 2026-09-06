import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-130 — the connector surface states what it can derive and nothing else.
//   FR-130 removed hardcoded 'CONNECTED' badges for connectors that did not exist;
//   five more claims of the same kind survived on the same page and were found
//   live on production 2026-09-04.
// @req FR-141 — the edge device strip may show only what the heartbeat reports.
// @spec SDD-076
// @tested this file
//
// Client components run under a node test environment with no DOM (see
// audit-page.test.js), so the shipped source is the checkable surface.

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const shipped = (source) => source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'src/app/(pm)/platform/integrations/page.jsx'
const SERVICE = 'src/modules/integration/application/line-registry-service.js'

describe('the edge device strip shows only what the device reported', () => {
  const page = shipped(src(PAGE))

  it('names no engine, model or RAG stack the heartbeat does not carry', () => {
    // zEdgeDeviceHeartbeat has contractVersion, businessId, deviceId, deviceToken,
    // status, registeredQueries, approvedTemplates, timestamp. No engine. No model.
    expect(page).not.toMatch(/GenesisBlock/)
    expect(page).not.toMatch(/Codex Luna|gpt-5\.6-luna/)
    expect(page).not.toMatch(/RAG Engine/)
    expect(page).not.toMatch(/Zero Token Cost/)
  })

  it('reads no field the heartbeat contract does not define', () => {
    // `device?.engine || 'literal'` is worse than a plain literal: the fallback
    // ran every time while reading like a derived value.
    expect(page).not.toMatch(/device\?\.engine/)
    expect(page).not.toMatch(/device\?\.model/)
  })

  it('shows the counts the device actually sends', () => {
    expect(page).toMatch(/device\?\.registeredQueries\?\.length/)
    expect(page).toMatch(/device\?\.approvedTemplates\?\.length/)
  })
})

describe('the page offers no automation it cannot run', () => {
  const page = shipped(src(PAGE))

  it('has no daily-report affordance', () => {
    // Nothing dispatches PUSH_DAILY_SALES_REPORT; there is no scheduler in this
    // repository. The checkbox defaulted ON, so every group registered through
    // the form got a report that was never sent.
    expect(page).not.toMatch(/enableDailyReport/)
    expect(page).not.toMatch(/reportSchedule/)
    expect(page).not.toMatch(/PUSH_DAILY_SALES_REPORT/)
  })

  it('does not render stored jobs under a success tick', () => {
    expect(page).not.toMatch(/Automate Jobs/)
  })

  it('does not advertise a scheduling system in its own subtitle', () => {
    expect(page).not.toMatch(/ระบบตั้งเวลางานอัตโนมัติ/)
  })

  it('sends no automationJobs, so a save cannot erase what is stored', () => {
    expect(page).not.toMatch(/automationJobs,/)
  })
})

describe('stored automation jobs survive a save that does not mention them', () => {
  const service = src(SERVICE)

  it('takes the field as optional rather than defaulting it to empty', () => {
    // `.default([])` plus a payload that omits the field is a silent delete.
    expect(service).toMatch(/automationJobs: z\.array\(zAutomationJob\)\.optional\(\)/)
    expect(service).not.toMatch(/automationJobs: z\.array\(zAutomationJob\)\.default\(\[\]\)/)
  })

  it('falls back to what the row already holds', () => {
    expect(service).toMatch(/validated\.automationJobs \?\? storedAutomationJobs\(existing\)/)
  })
})

describe('the pairing panel describes the credential it actually mints', () => {
  const page = shipped(src(PAGE))

  it('no longer describes a two-part token and HMAC secret', () => {
    // PR #213 replaced that scheme with a single `edgk_` bearer.
    expect(page).not.toMatch(/Pairing Token \(Public Identifier\)/)
    expect(page).not.toMatch(/HMAC/)
  })

  it('no longer promises the download is limited to one attempt', () => {
    // Nothing limited it: downloadPairingJson builds a Blob from React state and
    // the button can be pressed repeatedly. A security assurance nothing enforced.
    expect(page).not.toMatch(/ดาวน์โหลดไฟล์ <code>\.json<\/code> ได้เพียง 1 ครั้ง/)
  })

  it('states the true one-shot property — the key itself is shown once', () => {
    expect(page).toMatch(/แสดงค่าจริงครั้งเดียวเท่านั้น/)
  })

  it('still mints through the server, not in the browser', () => {
    expect(page).toContain("fetch('/api/platform/edge-devices/credentials'")
  })
})

describe('the connector catalog stays derived (FR-130 must not regress)', () => {
  const page = shipped(src(PAGE))

  it('reads each connector state rather than asserting one', () => {
    expect(page).toMatch(/item\.state === 'CONNECTED'/)
    expect(page).not.toMatch(/status: 'CONNECTED'/)
  })
})

describe('the webhook panel claims only what this system does (BR-011)', () => {
  const page = shipped(src(PAGE))

  it('does not claim it verifies the LINE webhook challenge', () => {
    // The route handles no challenge, and BR-011 gives signature verification to
    // zuri.command-agent.
    expect(page).not.toMatch(/Webhook Verification Challenge/)
  })

  it('does not claim it pushes replies to the LINE Messaging API', () => {
    // Nothing under src/ calls api.line.me. The webhook route returns reply text
    // "without receiving or consuming the LINE replyToken here".
    expect(page).not.toMatch(/ส่งข้อความตอบกลับไปยัง LINE Messaging API/)
  })

  it('names the owner of the half it does not perform', () => {
    // The split is the design, not something to leave unsaid.
    expect(page).toMatch(/zuri\.command-agent/)
    expect(page).toMatch(/BR-011/)
  })

  it('still describes the half it does perform', () => {
    expect(page).toMatch(/Group ID/)
    expect(page).toMatch(/User ID/)
  })
})
