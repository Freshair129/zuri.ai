// @req FR-266 — the model key card renders the entry form, shows only non-secret
//   status, and never renders any part of a key — there is nothing to render,
//   because the status shape it is given carries none.
// @req FR-265 — the Studio account console no longer offers an execution
//   placement or a model-access policy, and never asks for EDGE.
// @spec ADR-100 D1, D3, D4; SEC-030; SDD-101
// @tested tests/unit/line-oa-model-key-card-render.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LineOaModelKeyCard from '@/modules/line-oa-studio/ui/LineOaModelKeyCard'

globalThis.React = React

const catalogue = {
  providers: ['anthropic', 'openai'],
  suggestedModels: { anthropic: 'claude-sonnet-5', openai: 'gpt-4o-mini' },
}

const render = (status) => renderToStaticMarkup(
  createElement(LineOaModelKeyCard, { businessId: 'biz-1', status, api: async () => ({}) }),
)

describe('LINE OA model key card', () => {
  it('asks for a key when the Business has none, and says whose the cost is', () => {
    const html = render({ modelCredential: null, ...catalogue })
    expect(html).toContain('ยังไม่ได้ใส่คีย์')
    expect(html).toContain('บันทึกคีย์')
    expect(html).toContain('ค่าใช้จ่ายการเรียกโมเดลเป็นของธุรกิจเอง')
    // Nothing to rotate or revoke before a key exists.
    expect(html).not.toContain('เพิกถอนคีย์')
  })

  it('reports a validated key as ready, with provider and model but no key material', () => {
    // `lastValidationCode` is part of the fixture now because it is part of what
    // the server sends. The first version of this test omitted it and passed only
    // because "ready" ignored the outcome — the defect below.
    const html = render({
      modelCredential: {
        connectionId: 'conn-1', provider: 'anthropic', model: 'claude-sonnet-5',
        status: 'ACTIVE', secretStore: 'ENVELOPE', lastValidatedAt: '2026-09-21T00:00:00.000Z',
        lastValidationCode: 'MODEL_KEY_VALIDATED:ANTHROPIC', version: 2,
      },
      ...catalogue,
    })
    expect(html).toContain('พร้อมใช้งาน')
    expect(html).toContain('claude-sonnet-5')
    expect(html).toContain('เปลี่ยนคีย์')
    expect(html).toContain('เพิกถอนคีย์')
  })

  it('does not call a key ready when its last check failed, and says why', () => {
    // A refused re-validation still stamps `lastValidatedAt`. Reading only the time
    // showed a key that had just failed as "พร้อมใช้งาน".
    for (const [code, reason] of [['MODEL_NOT_FOUND', 'ไม่มีโมเดลนี้'], ['MODEL_KEY_REJECTED', 'ปฏิเสธคีย์นี้']]) {
      const html = render({
        modelCredential: {
          connectionId: 'conn-1', provider: 'openai', model: 'gpt-4o-mini', status: 'ACTIVE',
          lastValidatedAt: '2026-09-21T00:00:00.000Z', lastValidationCode: code, version: 2,
        },
        ...catalogue,
      })
      expect(html).not.toContain('พร้อมใช้งาน')
      expect(html).toContain('ต้องตรวจสอบใหม่')
      expect(html).toContain('การตรวจครั้งล่าสุดไม่ผ่าน')
      expect(html).toContain(reason)
    }
  })

  it('fills the suggested model, and an emptied field reads as empty', () => {
    // Static rendering cannot replay "status arrives after the first render", so
    // the value half of this test would pass against the old card too. The guard
    // for that defect is the not-yet-loaded test below, which the old card fails
    // (it rendered the form with no status). This test pins the value the form is
    // initialised with, and — the part it does guard — the "เช่น …" placeholder.
    const html = render({ modelCredential: null, ...catalogue })
    expect(html).toMatch(/id="model-id-biz-1"[^>]*value="claude-sonnet-5"|value="claude-sonnet-5"[^>]*id="model-id-biz-1"/)
    // And an emptied field reads as empty: the placeholder is "เช่น …", not a bare value.
    expect(html).toContain('placeholder="เช่น claude-sonnet-5"')
  })

  it('restores the saved provider and model, not the first in the list', () => {
    const html = render({
      modelCredential: {
        connectionId: 'conn-1', provider: 'openai', model: 'gpt-4.1-mini', status: 'ACTIVE',
        lastValidatedAt: '2026-09-21T00:00:00.000Z', lastValidationCode: 'MODEL_KEY_VALIDATED:OPENAI', version: 1,
      },
      ...catalogue,
    })
    expect(html).toMatch(/<option value="openai" selected=""/)
    expect(html).toContain('value="gpt-4.1-mini"')
  })

  it('shows a plain status line, not a half-built form, before the status has loaded', () => {
    for (const status of [null, undefined]) {
      const html = render(status)
      expect(html).toContain('กำลังอ่านสถานะคีย์')
      // No provider list with no options, and no save button that can never enable.
      expect(html).not.toContain('<select')
      expect(html).not.toContain('บันทึกคีย์')
    }
  })

  it('does not call a stored, never-validated key ready', () => {
    const html = render({
      modelCredential: { connectionId: 'conn-1', provider: 'anthropic', model: 'claude-sonnet-5', status: 'ACTIVE', lastValidatedAt: null, version: 1 },
      ...catalogue,
    })
    expect(html).toContain('ต้องตรวจสอบใหม่')
    expect(html).not.toContain('พร้อมใช้งาน')
  })

  it('renders the key input as a password field no browser will fill with a saved login', () => {
    // This used to assert `autoComplete="off"` under the same title — which is the
    // value Chrome ignores on password fields. The title was the intent; the
    // assertion pinned the bug. `new-password` is the value browsers honour.
    const html = render({ modelCredential: null, ...catalogue })
    const keyInput = html.match(/<input[^>]*id="model-key-biz-1"[^>]*>/)?.[0] ?? ''
    expect(keyInput).toContain('type="password"')
    expect(keyInput).toMatch(/autoComplete="new-password"/i)
    expect(keyInput).not.toMatch(/autoComplete="off"/i)
    expect(keyInput).toContain('data-1p-ignore="true"')
  })

  it('never suggests a model the server would have to guess for the owner', () => {
    // The suggestion is rendered as an editable value, not applied silently.
    const source = readFileSync(resolve(process.cwd(), 'src/modules/line-oa-studio/ui/LineOaModelKeyCard.jsx'), 'utf8')
    expect(source).toContain('suggested[provider]')
    expect(source).not.toMatch(/model:\s*['"]claude/)
  })
})

describe('LINE OA account console after FR-265', () => {
  const source = () => readFileSync(resolve(process.cwd(), 'src/modules/line-oa-studio/ui/LineStudioAccountConsole.jsx'), 'utf8')

  // Each assertion names what the console would have to *do*, not what its
  // source happens to mention: the comments that explain the retirement name
  // every retired identifier, and a test that banned the words would fail on
  // its own explanation.
  it('offers no execution placement, model-access policy or transport switch', () => {
    const html = source()
    expect(html).not.toContain('aria-label="ประมวลผลคำตอบ"')
    expect(html).not.toContain('aria-label="การใช้โมเดล"')
    expect(html).not.toContain('action: "SWITCH_TRANSPORT_MODE"')
    expect(html).not.toContain('value="LOCAL_ONLY"')
    expect(html).not.toContain('value="EDGE"')
    expect(html).not.toContain('executionMode: mode')
    expect(html).not.toContain('modelAccess: access')
    // Reading `job.executionMode` back out of the ledger is evidence of how a
    // past turn ran, and stays readable on purpose (ADR-100 D6).
    expect(html).toContain('job.executionMode')
  })

  it('no longer advertises dispatching an answer to a paired device', () => {
    const html = source()
    expect(html).toContain('เรียกโมเดลด้วย API key ของธุรกิจ')
    expect(html).not.toContain('ส่งคำสั่งไปยัง')
  })

  it('still saves the delivery policy CONFIGURE_EXECUTION now carries alone', () => {
    expect(source()).toContain('action: "CONFIGURE_EXECUTION", allowDelayedPush: push')
  })
})
