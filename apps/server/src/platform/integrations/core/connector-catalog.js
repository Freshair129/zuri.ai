// @req FR-080 — the Platform connectors catalog: which connectors this product
//   lists, and what each one's state actually is for the Business being viewed.
// @req FR-130 — the correction this requirement must make rather than inherit.
//   The catalog used to carry a literal `status: 'CONNECTED'` per entry, and four
//   entries claimed it: LINE OA, OpenRouter, "Vercel Ingress & Webhooks" and
//   "GitHub Repositories". Two of those four have no connector in this repository
//   at all — nothing anywhere in `src/` speaks to GitHub or receives a Vercel
//   webhook — so the surface asserted a connection that could not exist. The
//   other two are connectable, but a literal would have said CONNECTED for a
//   Business that has never configured them.
// @spec ADR-032 D1-D4, SDD-044, SEC-016 — presentation metadata only; no
//   credential, reference or secret material passes through this module.
// @tested tests/unit/platform/connector-catalog.test.js
//
// WHY THE STATE IS DERIVED, NOT DECLARED
// --------------------------------------
// `connection-health.js` already wrote this rule down for a single connection:
// "a stored status column is a claim that was true once, and the failure mode is
// a dashboard that says CONNECTED while every event is failing." A hardcoded
// literal in a catalog array is that same claim with no evidence behind it at
// all — it was never even true once. So the catalog entry describes the
// connector (name, category, which provider codes it would appear as) and says
// nothing about state; state is computed here from the connection rows the read
// model already returns.
//
// WHY "NOT_CONNECTED" AND NOT "AVAILABLE"
// ---------------------------------------
// `AVAILABLE` reads as an offer — press Connect and it works. For seven of these
// entries no connector exists, so the offer is as unfounded as the CONNECTED was.
// The two reason codes below keep the difference visible rather than smoothing it
// into one friendlier word: NO_CONNECTION_RECORDED means this Business has not
// configured a connector that does exist; CONNECTOR_NOT_IMPLEMENTED means there
// is nothing here to configure.

import { CONNECTION_HEALTH_STATES } from './connection-health'

/** A connector this Business has no evidence of working. Not a health state. */
export const CONNECTOR_NOT_CONNECTED = 'NOT_CONNECTED'

export const CONNECTOR_STATES = Object.freeze([
  ...CONNECTION_HEALTH_STATES,
  CONNECTOR_NOT_CONNECTED,
])

export const CONNECTOR_REASONS = Object.freeze({
  /** The connector exists; this Business has recorded no connection for it. */
  NO_CONNECTION_RECORDED: 'NO_CONNECTION_RECORDED',
  /** No code in this repository connects this provider. */
  CONNECTOR_NOT_IMPLEMENTED: 'CONNECTOR_NOT_IMPLEMENTED',
  /** A connection row arrived without the computed health the read model owes. */
  NO_HEALTH_EVIDENCE: 'NO_HEALTH_EVIDENCE',
})

// Best-first. `evaluateConnectionHealth` resolves ONE connection worst-first, so
// a single misconfigured field is never hidden by a green field beside it. This
// list is the other direction on purpose: a catalog tile answers "can this
// Business use this connector", and one working connection answers yes even when
// a second, half-provisioned one sits beside it. The unhealthy one is not lost —
// it keeps its own row, with its own reasons, further down the same page.
const BEST_FIRST = Object.freeze(['CONNECTED', 'DEGRADED', 'ERROR', 'MISCONFIGURED', 'DISABLED'])

const normalize = (code) => String(code ?? '').trim().toLowerCase()

/**
 * The connectors this product lists.
 *
 * `providerCodes` is the binding to reality: the `IntegrationProvider.code`
 * values a connection for this entry would carry. An entry with an empty list is
 * declaring that nothing in this repository connects it — which is a fact about
 * the code, checked by `tests/unit/platform/connector-catalog.test.js` rather
 * than trusted.
 */
export const CONNECTOR_CATALOG = Object.freeze([
  {
    id: 'line-oa',
    name: 'LINE Official Account',
    description: 'แชตบอตซูริตอบลูกค้าอัตโนมัติ พร้อมระบบลงทะเบียนกลุ่มและส่งสรุปรายงาน',
    type: 'Channel / Ingress',
    badge: 'Primary Channel',
    category: 'CHANNELS',
    iconColor: '#06C755',
    providerCodes: ['LINE_OA'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (LLM Models)',
    description: 'เราเตอร์โมเดลปัญญาประดิษฐ์ เชื่อมต่อ Claude 3.5, GPT-4o, Gemini Flash',
    type: 'AI Models',
    badge: 'AI Core',
    category: 'AI_MODELS',
    iconColor: '#6366F1',
    providerCodes: ['openrouter'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'ส่งแจ้งเตือนและข้อความอัตโนมัติเข้า Slack Workspaces ของทีมงาน',
    type: 'Channel / Web',
    badge: 'Community',
    category: 'CHANNELS',
    iconColor: '#E01E5A',
    providerCodes: [],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'ซิงค์ฐานข้อมูลเอกสาร Project Wiki และ Task เข้าสู่ Zuri Workspace',
    type: 'Docs / Workspace',
    badge: 'Productivity',
    category: 'TOOLS',
    iconColor: '#000000',
    providerCodes: [],
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'เชื่อมต่อ Outlook, Teams และ OneDrive สำหรับการทำงานร่วมกันในองค์กร',
    type: 'Enterprise',
    badge: 'Enterprise',
    category: 'TOOLS',
    iconColor: '#0078D4',
    providerCodes: [],
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'เชื่อมต่อ Google Gemini Pro และ Flash สำหรับการประมวลผลเอกสาร',
    type: 'AI Models',
    badge: 'AI Core',
    category: 'AI_MODELS',
    iconColor: '#4285F4',
    // `gemini` is in PUBLIC_LINE_PROVIDERS, so this one was wrong in the other
    // direction: the old literal said AVAILABLE for a provider the Phase 1 model
    // form has always been able to connect.
    providerCodes: ['gemini'],
  },
  {
    id: 'vercel-webhook',
    name: 'Vercel Ingress & Webhooks',
    description: 'ช่องทางรับ Webhook เหตุการณ์อัตโนมัติจาก Vercel Cloud Serverless',
    type: 'Web',
    badge: 'Infrastructure',
    category: 'TOOLS',
    iconColor: '#000000',
    providerCodes: [],
    note: 'ไม่มี endpoint รับ webhook จาก Vercel ในระบบนี้ — `/api/agent/line-webhook` เป็นตัวรับ webhook เพียงตัวเดียวที่มีอยู่จริง',
  },
  {
    id: 'gmail-alerts',
    name: 'Gmail & Email Dispatcher',
    description: 'ระบบส่งอีเมลแจ้งเตือนใบเสนอราคาและรายงานยอดขายประจำสัปดาห์',
    type: 'Web',
    badge: 'Mail',
    category: 'CHANNELS',
    iconColor: '#EA4335',
    providerCodes: [],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'ดึงและซิงค์ตารางนัดหมายลูกค้าและกำหนดการส่งมอบงาน',
    type: 'Web',
    badge: 'Calendar',
    category: 'TOOLS',
    iconColor: '#4285F4',
    providerCodes: [],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'จัดเก็บและแชร์เอกสาร สัญญาซื้อขาย และไฟล์แนบของโครงการ',
    type: 'Storage',
    badge: 'Storage',
    category: 'TOOLS',
    iconColor: '#34A853',
    providerCodes: [],
  },
  {
    id: 'github',
    name: 'GitHub Repositories',
    // What is true today, and only that: FR-008/FR-073 record a Repository's
    // provider, name, URL and default branch locally. No GitHub API access
    // exists — the /repositories page has said so in its own subtitle since it
    // shipped, while this tile claimed CONNECTED beside it.
    description: 'บันทึก metadata ของคลังซอร์สโค้ด (provider, ชื่อ, URL, default branch) ที่หน้า /repositories',
    type: 'Code',
    badge: 'DevOps',
    category: 'TOOLS',
    iconColor: '#24292E',
    providerCodes: [],
    note: 'ยังไม่มีการเข้าถึง GitHub API — อ่านไฟล์หรือ tree ในคอนโซลไม่ได้ (FR-130 ยังติด blocker เรื่องข้อมูลส่วนบุคคล)',
  },
])

/**
 * One connector's state, computed from the connection rows the read model
 * returned for the Business in view.
 *
 * @param {object} entry        a CONNECTOR_CATALOG entry
 * @param {Array}  connections  rows from `listPhase1Integrations`
 * @returns {{ state: string, reasons: string[], connectionCount: number }}
 */
export function deriveConnectorStatus(entry, connections = []) {
  const codes = (entry?.providerCodes ?? []).map(normalize).filter(Boolean)
  if (codes.length === 0) {
    return {
      state: CONNECTOR_NOT_CONNECTED,
      reasons: [CONNECTOR_REASONS.CONNECTOR_NOT_IMPLEMENTED],
      connectionCount: 0,
    }
  }

  const matches = (Array.isArray(connections) ? connections : [])
    .filter((connection) => codes.includes(normalize(connection?.provider)))
  if (matches.length === 0) {
    return {
      state: CONNECTOR_NOT_CONNECTED,
      reasons: [CONNECTOR_REASONS.NO_CONNECTION_RECORDED],
      connectionCount: 0,
    }
  }

  const rank = (connection) => {
    const index = BEST_FIRST.indexOf(connection?.health?.state)
    return index === -1 ? BEST_FIRST.length : index
  }
  const best = matches.reduce((a, b) => (rank(b) < rank(a) ? b : a))

  // A row with no computed health is not evidence of a working connector. Fail
  // to NOT_CONNECTED rather than inheriting the green the literal used to give.
  if (!CONNECTION_HEALTH_STATES.includes(best?.health?.state)) {
    return {
      state: CONNECTOR_NOT_CONNECTED,
      reasons: [CONNECTOR_REASONS.NO_HEALTH_EVIDENCE],
      connectionCount: matches.length,
    }
  }

  return {
    state: best.health.state,
    reasons: Array.isArray(best.health.reasons) ? best.health.reasons : [],
    connectionCount: matches.length,
  }
}

/** The whole catalog with each entry's derived state attached. */
export function deriveConnectorCatalog(connections = [], catalog = CONNECTOR_CATALOG) {
  return catalog.map((entry) => ({ ...entry, ...deriveConnectorStatus(entry, connections) }))
}
