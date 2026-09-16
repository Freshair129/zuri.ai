// @req FR-220 — the Agent devices tab lists paired devices with person, label,
//   status and key prefix (never a key), offers activate only for a pending device
//   and revoke for any device not yet revoked; the board exposes it as a tab.
// @req FR-221 — the board shows usage per person, and reports on no lane.
// @spec ADR-087 D2-D4; NFR-008
// @tested tests/unit/harness-devices-view.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HarnessDevicesView from '@/modules/platform-control/components/HarnessDevicesView'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { mergeLaneUsage, UNATTRIBUTED_LANE } from '@/modules/platform-control/program-delivery-metrics'
import { PROGRAMME_LANES } from '@/modules/platform-control/program-roadmap-telemetry'

globalThis.React = React

const device = (over) => ({
  id: 'hc-1', installationId: 'inst-1', personDisplayName: 'Ploy', harness: 'CLAUDE_CODE', deviceLabel: 'DESKTOP-VETATMQ', osUser: 'pc',
  keyPrefix: 'hrnk_AbCdEfGh', status: 'ACTIVE', createdAt: '2026-09-14T03:00:00.000Z', lastUsedAt: null, version: 1, ...over,
})

describe('FR-220 Agent devices tab', () => {
  it('renders devices with the right actions and no key material', () => {
    const html = renderToStaticMarkup(createElement(HarnessDevicesView, {
      initialDevices: [device(), device({ id: 'hc-2', installationId: 'inst-2', status: 'PENDING_ACTIVATION', personDisplayName: 'Nok', harness: 'CODEX' }), device({ id: 'hc-3', installationId: 'inst-3', status: 'REVOKED' })],
    }))
    const row = (inst) => html.slice(html.indexOf(`harness-device-${inst}`), html.indexOf('</tr>', html.indexOf(`harness-device-${inst}`)))
    expect(row('inst-1')).toContain('DESKTOP-VETATMQ')
    expect(row('inst-1')).toContain('เพิกถอน')
    expect(row('inst-1')).not.toContain('เปิดใช้งาน')
    expect(row('inst-2')).toContain('เปิดใช้งาน')
    expect(row('inst-2')).toContain('Codex')
    expect(row('inst-3')).not.toContain('เพิกถอน')
    expect(html).toContain('hrnk_AbCdEfGh…')
    expect(html).not.toMatch(/keyHash/)
  })

  it('states when nothing is paired', () => {
    expect(renderToStaticMarkup(createElement(HarnessDevicesView, { initialDevices: [] }))).toContain('harness-devices-empty')
  })

  it('opens as a tab of the operator board', () => {
    const html = renderToStaticMarkup(createElement(ProgramRoadmapBoard, { domainMap: { domains: [], overall: {} }, initialView: 'devices' }))
    expect(html).toContain('roadmap-tab-devices')
    expect(html).toContain('harness-devices-view')
  })
})

describe('FR-221 usage per person and unattributed reports', () => {
  const lane = PROGRAMME_LANES.find((l) => l.id === 'LANE-HARNESS-USAGE-PLUGIN')
  const report = (over) => ({
    source: 'claude-code', sessionId: 'sess-remote-1', branch: lane.branches[1], taskCode: null, installationId: 'inst-1',
    inputTokens: 100, cacheWriteTokens: 1000, cacheReadTokens: 50000, outputTokens: 400, requestCount: 10, activeMinutes: 12,
    startedAt: '2026-09-14T01:00:00.000Z', endedAt: '2026-09-14T01:20:00.000Z', ...over,
  })
  const reporters = { 'inst-1': { personDisplayName: 'Ploy', deviceLabel: 'DESKTOP-A' }, 'inst-2': { personDisplayName: 'Nok', deviceLabel: 'MACBOOK-B' } }

  it('attributes a lane by branch, breaks it down by person and device, and groups undeclared branches', () => {
    const merged = mergeLaneUsage({
      lanes: PROGRAMME_LANES,
      usage: { lanes: {} },
      reporters,
      reports: [
        report(),
        report({ sessionId: 'sess-remote-2', installationId: 'inst-2', outputTokens: 900 }),
        report({ sessionId: 'sess-remote-3', branch: 'feat/somewhere-else' }),
        report({ sessionId: 'sess-auto', installationId: null, taskCode: 'TASK-ZAI-071', branch: '' }),
      ],
    })
    const entry = merged.get('LANE-HARNESS-USAGE-PLUGIN')
    expect(entry.byPerson.Ploy.used).toBe(1500)
    expect(entry.byPerson.Nok.used).toBe(2000)
    expect(entry.byPerson.deployment.sessions).toBe(1)
    expect(entry.byDevice['MACBOOK-B'].sessions).toBe(1)
    expect(merged.get(UNATTRIBUTED_LANE).sessions).toBe(1)
  })

  it('does not count a session the meter already counted in the same lane', () => {
    const merged = mergeLaneUsage({
      lanes: PROGRAMME_LANES,
      reporters,
      usage: { lanes: { 'LANE-HARNESS-USAGE-PLUGIN': { requests: 5, sessions: ['claude-code:sess-remote-1'], tokens: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4 }, bySource: { 'claude-code': {} } } } },
      reports: [report()],
    })
    expect(merged.get('LANE-HARNESS-USAGE-PLUGIN').sessions).toBe(1)
    expect(merged.get('LANE-HARNESS-USAGE-PLUGIN').byPerson['']).toBeTruthy()
    expect(merged.get('LANE-HARNESS-USAGE-PLUGIN').byPerson.Ploy).toBeUndefined()
  })
})
