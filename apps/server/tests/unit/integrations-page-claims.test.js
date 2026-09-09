import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-130 — the connector surface states what it can derive and nothing else.
//   FR-130 removed hardcoded 'CONNECTED' badges for connectors that did not exist;
//   five more claims of the same kind survived on the same page and were found
//   live on production 2026-09-04.
// @req FR-144 — the Integrations page no longer offers its own Edge Device
//   pairing/heartbeat panel; that surface now lives only on LINE OA Studio's
//   Edge Connection page (owner instruction 2026-09-09: one pairing surface,
//   not two duplicate/divergent ones).
// @spec SDD-076
// @tested this file
//
// Client components run under a node test environment with no DOM (see
// audit-page.test.js), so the shipped source is the checkable surface.

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const shipped = (source) => source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'src/app/(pm)/platform/integrations/page.jsx'
const SERVICE = 'src/modules/integration/application/line-registry-service.js'

describe('the Edge Device pairing/heartbeat panel never comes back to this page', () => {
  const page = shipped(src(PAGE))

  it('has no EDGE_LLM tab, mint form or heartbeat strip', () => {
    // Both used to live here: a heartbeat-driven online/offline strip (FR-141)
    // and a client-built pairing-key mint form (FR-144). Both now live only on
    // LINE OA Studio's Edge Connection page — a second copy on this page would
    // silently drift from the tested, canonical mint shape (edgePairingDownload).
    expect(page).not.toMatch(/EDGE_LLM/)
    expect(page).not.toMatch(/generateNewPairingKeys/)
    expect(page).not.toMatch(/Zero-Trust Edge Device Pairing Generator/)
    expect(page).not.toMatch(/edgePairingDownload/)
    expect(page).not.toMatch(/api\/agent\/heartbeat/)
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
