// @req FR-238 — the LINE Studio description composers never carry the Flex or
//   rich menu JSON, a coordinate, a URL, a postback `data` string, a LIFF app
//   code or an external LINE id; admission/withdrawal are best-effort and
//   never throw when the knowledge runtime is unavailable.
// @spec ADR-090 D7
// @tested tests/unit/line-oa-studio-description-admission.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  admitLineStudioDescription,
  composeBotProfileDescription,
  composeLiffAppDescription,
  composeRichMenuDescription,
  lineStudioDescriptionSourceKey,
  withdrawLineStudioDescription,
} from '@/modules/line-oa-studio/application/line-oa-studio-description-admission'

describe('FR-238 composers — human-readable text only', () => {
  it('rich menu: name, chat-bar text and area labels/spoken text; never bounds, uri, data, liffAppCode or richMenuAlias', () => {
    const text = composeRichMenuDescription({
      name: 'เมนูหลัก',
      chatBarText: 'เมนู',
      areas: [
        { bounds: { x: 0, y: 0, width: 100, height: 100 }, action: { type: 'MESSAGE', label: 'สวัสดี', text: 'สวัสดีค่ะ' } },
        { bounds: { x: 100, y: 0, width: 100, height: 100 }, action: { type: 'POSTBACK', label: 'สั่งซื้อ', data: 'action=order&secret=xyz', displayText: 'กำลังสั่งซื้อ' } },
        { bounds: { x: 0, y: 100, width: 100, height: 100 }, action: { type: 'URI', label: 'เว็บไซต์', uri: 'https://example.com/secret-path' } },
        { bounds: { x: 100, y: 100, width: 100, height: 100 }, action: { type: 'LIFF', label: 'ร้านค้า', liffAppCode: 'shop-app' } },
      ],
    })
    expect(text).toContain('เมนูหลัก')
    expect(text).toContain('แถบแชท: เมนู')
    expect(text).toContain('สวัสดีค่ะ')
    expect(text).toContain('กำลังสั่งซื้อ')
    // Never the tap target or transport data.
    expect(text).not.toContain('secret')
    expect(text).not.toContain('data=')
    expect(text).not.toContain('example.com')
    expect(text).not.toContain('shop-app')
    expect(text).not.toContain('100')
    expect(text).not.toMatch(/[{}[\]]/)
  })

  it('LIFF app: name and description only; never endpointUrl, scopes or liffId', () => {
    const text = composeLiffAppDescription({ name: 'ร้านค้า', description: 'สั่งซื้อสินค้าออนไลน์' })
    expect(text).toBe('ร้านค้า\nสั่งซื้อสินค้าออนไลน์')
  })

  it('bot profile: persona, greeting and fallback only', () => {
    const text = composeBotProfileDescription({ greeting: 'สวัสดีค่ะ', fallbackText: 'ขอโทษค่ะ ไม่เข้าใจ', personaLabel: 'ผู้ช่วยร้านค้า' })
    expect(text).toContain('ผู้ช่วยร้านค้า')
    expect(text).toContain('คำทักทาย: สวัสดีค่ะ')
    expect(text).toContain('ข้อความสำรอง: ขอโทษค่ะ ไม่เข้าใจ')
  })

  it('produces empty text for an all-empty aggregate, never a stray separator', () => {
    expect(composeLiffAppDescription({})).toBe('')
    expect(composeBotProfileDescription({})).toBe('')
    expect(composeRichMenuDescription({ areas: [] })).toBe('')
  })
})

describe('FR-238 sourceKey helpers — stable per aggregate, never per version', () => {
  it('derive one key per rich menu / LIFF app / account id', () => {
    expect(lineStudioDescriptionSourceKey.richMenu('menu-1')).toBe('line-studio-description:rich-menu:menu-1')
    expect(lineStudioDescriptionSourceKey.liffApp('app-1')).toBe('line-studio-description:liff-app:app-1')
    expect(lineStudioDescriptionSourceKey.botProfile('acct-1')).toBe('line-studio-description:bot-profile:acct-1')
  })
})

describe('FR-238 admission/withdrawal — best-effort, never blocks the caller', () => {
  it('admitLineStudioDescription swallows a knowledge-runtime failure and reports admitted:false', async () => {
    const admit = vi.fn(async () => { throw Object.assign(new Error('unavailable'), { code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' }) })
    const result = await admitLineStudioDescription(
      { businessId: 'biz-1', sourceKey: 'k', version: '1', title: 't', content: 'human text' },
      { admit },
    )
    expect(result).toEqual({ admitted: false, code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' })
  })

  it('admitLineStudioDescription calls the admission service with kind LINE_STUDIO_DESCRIPTION and never the raw structured input', async () => {
    const admit = vi.fn(async () => ({ id: 'ing-1' }))
    const result = await admitLineStudioDescription(
      { businessId: 'biz-1', sourceKey: 'k', version: 3, title: 't', content: 'human text only' },
      { admit },
    )
    expect(result.admitted).toBe(true)
    const [input, options] = admit.mock.calls[0]
    expect(input.source).toEqual({ kind: 'LINE_STUDIO_DESCRIPTION', sourceKey: 'k', version: '3', title: 't', content: 'human text only' })
    expect(input.businessId).toBe('biz-1')
    expect(await options.authorization()).toEqual({ authorized: true })
  })

  it('admitLineStudioDescription is a no-op for empty composed content', async () => {
    const admit = vi.fn()
    const result = await admitLineStudioDescription({ businessId: 'biz-1', sourceKey: 'k', version: '1', content: '   ' }, { admit })
    expect(result).toEqual({ admitted: false, code: 'LINE_STUDIO_DESCRIPTION_EMPTY' })
    expect(admit).not.toHaveBeenCalled()
  })

  it('withdrawLineStudioDescription is a no-op when nothing was ever admitted', async () => {
    const repository = { findCorpusByKey: vi.fn(async () => null), findSource: vi.fn() }
    const withdraw = vi.fn()
    const result = await withdrawLineStudioDescription({ businessId: 'biz-1', sourceKey: 'k' }, { repository, withdraw })
    expect(result).toEqual({ withdrawn: false, code: 'LINE_STUDIO_DESCRIPTION_NOT_ADMITTED' })
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('withdrawLineStudioDescription is a no-op when the source is already revoked', async () => {
    const repository = {
      findCorpusByKey: vi.fn(async () => ({ id: 'corpus-1' })),
      findSource: vi.fn(async () => ({ id: 'src-1', version: 1, revokedAt: new Date() })),
    }
    const withdraw = vi.fn()
    const result = await withdrawLineStudioDescription({ businessId: 'biz-1', sourceKey: 'k' }, { repository, withdraw })
    expect(result).toEqual({ withdrawn: false, code: 'LINE_STUDIO_DESCRIPTION_NOT_ADMITTED' })
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('withdrawLineStudioDescription calls withdrawKnowledgeSource with a trusted authorization override', async () => {
    const repository = {
      findCorpusByKey: vi.fn(async () => ({ id: 'corpus-1' })),
      findSource: vi.fn(async () => ({ id: 'src-1', version: 2, revokedAt: null })),
    }
    const withdraw = vi.fn(async () => ({ status: 'WITHDRAWN' }))
    const result = await withdrawLineStudioDescription({ businessId: 'biz-1', sourceKey: 'k' }, { repository, withdraw })
    expect(result).toEqual({ withdrawn: true })
    const [sourceId, versionArg, options] = withdraw.mock.calls[0]
    expect(sourceId).toBe('src-1')
    expect(versionArg).toEqual({ expectedVersion: 2 })
    expect(await options.authorization()).toEqual({ authorized: true })
  })

  it('withdrawLineStudioDescription swallows a withdrawal failure', async () => {
    const repository = {
      findCorpusByKey: vi.fn(async () => ({ id: 'corpus-1' })),
      findSource: vi.fn(async () => ({ id: 'src-1', version: 2, revokedAt: null })),
    }
    const withdraw = vi.fn(async () => { throw Object.assign(new Error('conflict'), { code: 'KNOWLEDGE_SOURCE_VERSION_CONFLICT' }) })
    const result = await withdrawLineStudioDescription({ businessId: 'biz-1', sourceKey: 'k' }, { repository, withdraw })
    expect(result).toEqual({ withdrawn: false, code: 'KNOWLEDGE_SOURCE_VERSION_CONFLICT' })
  })
})
