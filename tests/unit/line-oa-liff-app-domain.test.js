// @req FR-153 — the pure rules of the LIFF app registry, proven without a
//   database: the input contracts, the liffId shape, the initial status, the
//   URL a registered app resolves to, and how a rich menu LIFF action is
//   resolved or refused.
// @spec SRS LOS-RQ-070; BR-002; ADR-060 D6
// @tested tests/unit/line-oa-liff-app-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  LINE_OA_LIFF_APP_STATUSES,
  initialLiffStatus,
  liffUrl,
  parseScopes,
  resolveLiffAction,
  zLiffAppAction,
  zLiffId,
  zRegisterLiffApp,
} from '@/modules/line-oa-studio/domain/line-oa-liff-app'
import { buildLineRichMenuObject, translateAction } from '@/modules/line-oa-studio/domain/line-oa-rich-menu-publish'

const LIFF_ID = '1234567890-AbCdEfGh'
const base = { accountId: 'acc', code: 'shop', name: 'Shop', endpointUrl: 'https://shop.example/liff' }

describe('FR-153 LIFF app domain rules', () => {
  it('shapes a registration: https endpoint, allow-listed scopes and view sizes, a LINE-shaped liffId', () => {
    expect(zRegisterLiffApp.safeParse(base).success).toBe(true)
    expect(zRegisterLiffApp.safeParse({ ...base, liffId: LIFF_ID, viewSize: 'TALL', scopes: ['profile', 'openid'], botPrompt: 'NONE' }).success).toBe(true)
    expect(zRegisterLiffApp.safeParse({ ...base, endpointUrl: 'http://shop.example' }).success).toBe(false)
    expect(zRegisterLiffApp.safeParse({ ...base, scopes: ['profile', 'profile'] }).success).toBe(false)
    expect(zRegisterLiffApp.safeParse({ ...base, scopes: ['admin'] }).success).toBe(false)
    expect(zRegisterLiffApp.safeParse({ ...base, viewSize: 'HUGE' }).success).toBe(false)
    expect(zRegisterLiffApp.safeParse({ ...base, liffId: 'liff-123' }).success).toBe(false)
    expect(zRegisterLiffApp.safeParse({ ...base, status: 'ACTIVE' }).success).toBe(false)
    expect(zLiffId.safeParse(LIFF_ID).success).toBe(true)
    expect(zLiffId.safeParse('123-abc').success).toBe(false)
  })

  it('starts ACTIVE only with a known liffId, and lists three stored statuses', () => {
    expect(initialLiffStatus({})).toBe('DRAFT')
    expect(initialLiffStatus({ liffId: LIFF_ID })).toBe('ACTIVE')
    expect(LINE_OA_LIFF_APP_STATUSES).toEqual(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  })

  it('shapes actions: UPDATE needs fields, RECORD_LIFF_ID needs a liffId', () => {
    expect(zLiffAppAction.safeParse({ action: 'UPDATE', version: 1 }).success).toBe(false)
    expect(zLiffAppAction.safeParse({ action: 'UPDATE', version: 1, fields: { name: 'New' } }).success).toBe(true)
    expect(zLiffAppAction.safeParse({ action: 'RECORD_LIFF_ID', version: 1 }).success).toBe(false)
    expect(zLiffAppAction.safeParse({ action: 'RECORD_LIFF_ID', version: 1, liffId: LIFF_ID }).success).toBe(true)
    expect(zLiffAppAction.safeParse({ action: 'ARCHIVE', version: 2 }).success).toBe(true)
    expect(zLiffAppAction.safeParse({ action: 'DELETE', version: 1 }).success).toBe(false)
  })

  it('builds the liff.line.me URL with an optional path or query', () => {
    expect(liffUrl(LIFF_ID)).toBe(`https://liff.line.me/${LIFF_ID}`)
    expect(liffUrl(LIFF_ID, 'orders/42')).toBe(`https://liff.line.me/${LIFF_ID}/orders/42`)
    expect(liffUrl(LIFF_ID, '/orders')).toBe(`https://liff.line.me/${LIFF_ID}/orders`)
    expect(liffUrl(LIFF_ID, '?ref=menu')).toBe(`https://liff.line.me/${LIFF_ID}?ref=menu`)
  })

  it('resolves a LIFF action only through an ACTIVE app with a recorded id', () => {
    const active = { code: 'shop', status: 'ACTIVE', externalLiffId: LIFF_ID }
    const draft = { code: 'draft', status: 'DRAFT', externalLiffId: null }
    const archived = { code: 'old', status: 'ARCHIVED', externalLiffId: LIFF_ID }
    const apps = [active, draft, archived]
    expect(resolveLiffAction({ type: 'LIFF', liffAppCode: 'shop', path: 'cart' }, apps)).toMatchObject({ ok: true, uri: `https://liff.line.me/${LIFF_ID}/cart` })
    expect(resolveLiffAction({ type: 'LIFF', liffAppCode: 'draft' }, apps)).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_NOT_ACTIVE' })
    expect(resolveLiffAction({ type: 'LIFF', liffAppCode: 'old' }, apps)).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_NOT_ACTIVE' })
    expect(resolveLiffAction({ type: 'LIFF', liffAppCode: 'missing' }, apps)).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' })
    expect(resolveLiffAction({ type: 'URI', uri: 'https://x' }, apps)).toEqual({ ok: false, code: 'LINE_OA_LIFF_ACTION_INVALID' })
  })

  it('lets the rich menu translator turn a LIFF action into a uri action, and refuse it without the registry', () => {
    const apps = [{ code: 'shop', status: 'ACTIVE', externalLiffId: LIFF_ID }]
    expect(translateAction({ type: 'LIFF', liffAppCode: 'shop', label: 'Shop' }, { liffApps: apps })).toEqual({ ok: true, value: { type: 'uri', label: 'Shop', uri: `https://liff.line.me/${LIFF_ID}` } })
    expect(translateAction({ type: 'LIFF', liffAppCode: 'shop' })).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' })
    const version = { imageWidth: 2500, imageHeight: 843, selected: false, chatBarText: 'เมนู', areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'LIFF', liffAppCode: 'shop', path: '?ref=rm' } }] }
    const built = buildLineRichMenuObject({ menu: { name: 'Main' }, version, liffApps: apps })
    expect(built.ok).toBe(true)
    expect(built.value.areas[0].action).toEqual({ type: 'uri', uri: `https://liff.line.me/${LIFF_ID}?ref=rm` })
  })

  it('reads a stored scopes column defensively', () => {
    expect(parseScopes('["profile","openid"]')).toEqual(['profile', 'openid'])
    expect(parseScopes('["admin"]')).toEqual([])
    expect(parseScopes('nope')).toEqual([])
  })
})
