import { readFileSync } from 'node:fs'
import path from 'node:path'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolvePlatformControlDecision } from '@/lib/platform-control-guard'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { mergeLaneUsage, phaseDeliveryMetrics } from '@/modules/platform-control/program-delivery-metrics'
import { PROGRAMME_LANES, PROGRAMME_SIZING, PROGRAMME_USAGE } from '@/modules/platform-control/program-roadmap-telemetry'
import {
  isMemberViewOpen,
  MEMBER_VIEW_CLOSES_AT,
  projectMemberLaneUsage,
  resolveMemberRoadmapDecision,
} from '@/modules/platform-control/programme-member-view'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

// @req FR-241 — a 30-day roadmap view for any signed-in person, with no person,
//   device, tool or model name reaching the client.
// @spec ADR-092 D1–D3, ADR-048 D2
// @tested tests/unit/programme-member-view.test.js

globalThis.React = React

const OPEN = Date.parse('2026-09-20T00:00:00+07:00')
const LAST_MINUTE = Date.parse('2026-10-14T23:59:00+07:00')
const CLOSED = Date.parse('2026-10-15T00:00:00+07:00')
const fromRoot = (...parts) => path.join(process.cwd(), ...parts)

describe('FR-241 window', () => {
  it('closes at 2026-10-15 00:00 Asia/Bangkok, 30 days after the instruction', () => {
    expect(MEMBER_VIEW_CLOSES_AT).toBe('2026-10-14T17:00:00.000Z')
    expect((Date.parse(MEMBER_VIEW_CLOSES_AT) - Date.parse('2026-09-15T00:00:00+07:00')) / 86400000).toBe(30)
    expect(isMemberViewOpen(LAST_MINUTE)).toBe(true)
    expect(isMemberViewOpen(CLOSED)).toBe(false)
  })

  it('admits any signed-in person while open, with no Business, role or grant', () => {
    expect(resolveMemberRoadmapDecision({ viewer: makeViewer({ visibleBusinessIds: [] }), now: OPEN })).toEqual({ state: 'READY' })
    expect(resolveMemberRoadmapDecision({ viewer: makeOperatorViewer(), now: OPEN })).toEqual({ state: 'READY' })
  })

  it('sends a visitor without a session to /login and keeps an outage apart', () => {
    expect(resolveMemberRoadmapDecision({ viewer: null, now: OPEN })).toEqual({ state: 'AUTH_REQUIRED', redirect: '/login' })
    expect(resolveMemberRoadmapDecision({ viewerError: { status: 401, message: 'AUTH_REQUIRED' }, now: OPEN })).toEqual({ state: 'AUTH_REQUIRED', redirect: '/login' })
    expect(resolveMemberRoadmapDecision({ viewerError: { status: 503, message: 'SESSION_UNAVAILABLE' }, now: OPEN })).toEqual({ state: 'SESSION_UNAVAILABLE' })
  })

  it('is a 404 for everyone once closed — operators and visitors without a session included', () => {
    expect(resolveMemberRoadmapDecision({ viewer: makeViewer(), now: CLOSED })).toEqual({ state: 'CLOSED' })
    expect(resolveMemberRoadmapDecision({ viewer: makeOperatorViewer(), now: CLOSED })).toEqual({ state: 'CLOSED' })
    expect(resolveMemberRoadmapDecision({ viewer: null, now: CLOSED })).toEqual({ state: 'CLOSED' })
  })

  it('leaves /control/roadmap operator-only (ADR-048 D2)', () => {
    expect(resolvePlatformControlDecision({ viewer: makeViewer() })).toEqual({ state: 'FORBIDDEN' })
    expect(resolvePlatformControlDecision({ viewer: makeOperatorViewer() })).toEqual({ state: 'READY' })
  })
})

describe('FR-241 member projection', () => {
  const lane = PROGRAMME_LANES.find((l) => l.id === 'LANE-HARNESS-USAGE-PLUGIN')
  const detail = {
    reasoningTokens: 80, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, webSearchRequests: 0, webFetchRequests: 0,
    prompts: 2, toolCalls: 5, toolErrors: 1, toolDenials: 0, compactions: 0, apiErrors: 0,
    tools: { 'mcp__secret_connector__read': { calls: 5, errors: 1 } }, models: { 'claude-opus-5': 3 },
  }
  const operatorUsage = mergeLaneUsage({
    lanes: PROGRAMME_LANES,
    usage: { lanes: {} },
    reports: [{
      source: 'claude-code', sessionId: 'sess-1', branch: lane.branches[1], taskCode: null, personId: 'person-1', installationId: 'inst-1',
      inputTokens: 100, cacheWriteTokens: 1000, cacheReadTokens: 50000, outputTokens: 400, requestCount: 10, activeMinutes: 12,
      startedAt: '2026-09-14T01:00:00.000Z', endedAt: '2026-09-14T01:20:00.000Z', detail,
    }],
  })

  it('removes people, devices, tool and model names, and keeps lane totals and headline counts', () => {
    const member = projectMemberLaneUsage(operatorUsage)
    const serialized = JSON.stringify(member)
    for (const secret of ['person-1', 'mcp__secret_connector__read', 'claude-opus-5']) {
      expect(JSON.stringify(Object.fromEntries(operatorUsage))).toContain(secret)
      expect(serialized).not.toContain(secret)
    }
    const entry = member['LANE-HARNESS-USAGE-PLUGIN']
    expect(entry.tokens).toEqual({ input: 100, cacheWrite: 1000, cacheRead: 50000, output: 400 })
    expect(entry.sessions).toBe(1)
    expect(entry.detail).toMatchObject({ toolCalls: 5, toolErrors: 1, prompts: 2, reasoningTokens: 80, tools: {}, models: {} })
    expect(entry.byPerson).toEqual({})
    expect(entry).not.toHaveProperty('byDevice')
  })

  it('still feeds the phase card figures', () => {
    const phase = { id: 'PHASE-X', start: '2026-09-07', end: '2026-09-20', status: 'in-progress', sprints: [{ id: 'SPR-X' }] }
    const tasks = lane.tasks.map((id) => [id, 'SPR-X', 't', 'FR', 'C-2', 'H2', 'done'])
    const { measured } = phaseDeliveryMetrics({ phase, tasks, sizing: PROGRAMME_SIZING, lanes: PROGRAMME_LANES, laneUsage: new Map(Object.entries(projectMemberLaneUsage(operatorUsage))) })
    expect(measured.used).toBe(1500)
    expect(measured.detail.toolCalls).toBe(5)
  })

  it('renders without the Agent devices tab or per-person rows, even when asked for devices', () => {
    const html = renderToStaticMarkup(createElement(ProgramRoadmapBoard, {
      audience: 'member',
      closesAt: MEMBER_VIEW_CLOSES_AT,
      domainMap: { domains: [], overall: {} },
      initialView: 'devices',
      laneUsage: projectMemberLaneUsage(operatorUsage),
      lanes: PROGRAMME_LANES,
      sizing: PROGRAMME_SIZING,
      measuredThrough: PROGRAMME_USAGE.measuredThrough,
    }))
    expect(html).toContain('SIGNED-IN PREVIEW')
    expect(html).toContain('data-testid="member-view-window"')
    expect(html).toContain('roadmap-tab-domains')
    expect(html).not.toContain('roadmap-tab-devices')
    expect(html).not.toContain('harness-devices-view')
    expect(html).not.toContain('phase-people-')
    expect(html).not.toContain('Ploy Person')
    expect(html).toContain('data-testid="phase-metrics-PHASE-ZAI-01"')
  })
})

describe('FR-241 boundaries in source', () => {
  it('keeps the generated usage block out of the client board bundle', () => {
    const board = readFileSync(fromRoot('src', 'modules', 'platform-control', 'components', 'ProgramRoadmapBoard.jsx'), 'utf8')
    expect(board).not.toMatch(/from '@\/modules\/platform-control\/program-roadmap-telemetry'/)
  })

  it('projects on the server outside the control route group, without resolving reporters', () => {
    const page = readFileSync(fromRoot('src', 'app', 'roadmap', 'page.jsx'), 'utf8')
    expect(page).not.toMatch(/^'use client'/)
    expect(page).toContain('projectMemberLaneUsage(mergeLaneUsage(')
    expect(page).toContain('resolveMemberRoadmapDecision')
    expect(page).not.toContain('describeHarnessReporters')
    expect(page).toContain("audience=\"member\"")
  })
})
