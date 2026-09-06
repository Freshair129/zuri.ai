// @req FR-152 — the pure rules of the publish job: the LINE object built
//   from a frozen version through the action allow-list, the stage each kind
//   starts at, and what an ambiguous provider outcome means per stage.
// @spec ADR-060 D6; ADR-061 D7
// @tested tests/unit/line-oa-rich-menu-publish.test.js
import { describe, expect, it } from 'vitest'
import {
  buildLineRichMenuObject,
  initialStage,
  retryDelayMs,
  settleOutcome,
  translateAction,
} from '@/modules/line-oa-studio/domain/line-oa-rich-menu-publish'

const version = {
  imageWidth: 2500, imageHeight: 843, selected: true, chatBarText: 'เมนู',
  areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: 'MESSAGE', label: 'Hi', text: 'สวัสดี' } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: 'RICHMENU_SWITCH', richMenuAlias: 'menu-b', data: 'switch' } },
  ],
}

describe('FR-152 rich menu publish rules', () => {
  it('translates every allow-listed action to LINE\'s shape and refuses the unresolved LIFF one', () => {
    expect(translateAction({ type: 'MESSAGE', text: 'hi' })).toEqual({ ok: true, value: { type: 'message', text: 'hi' } })
    expect(translateAction({ type: 'POSTBACK', data: 'd', displayText: 'x' })).toEqual({ ok: true, value: { type: 'postback', data: 'd', displayText: 'x' } })
    expect(translateAction({ type: 'URI', uri: 'https://x' })).toEqual({ ok: true, value: { type: 'uri', uri: 'https://x' } })
    expect(translateAction({ type: 'RICHMENU_SWITCH', richMenuAlias: 'b', data: 's' })).toEqual({ ok: true, value: { type: 'richmenuswitch', richMenuAliasId: 'b', data: 's' } })
    expect(translateAction({ type: 'LIFF', liffAppCode: 'shop' })).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' })
    expect(translateAction({ type: 'DATETIMEPICKER' })).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_ACTION_UNKNOWN' })
  })

  it('builds the LINE rich menu object from a menu and a version', () => {
    const built = buildLineRichMenuObject({ menu: { name: 'Main' }, version })
    expect(built.ok).toBe(true)
    expect(built.value).toEqual({
      size: { width: 2500, height: 843 }, selected: true, name: 'Main', chatBarText: 'เมนู',
      areas: [
        { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: 'message', label: 'Hi', text: 'สวัสดี' } },
        { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: 'richmenuswitch', richMenuAliasId: 'menu-b', data: 'switch' } },
      ],
    })
    expect(buildLineRichMenuObject({ menu: { name: 'x' }, version: { ...version, areasJson: '[]', areas: undefined } })).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_NO_AREAS' })
    expect(buildLineRichMenuObject({ menu: { name: 'x' }, version: { ...version, areas: [{ bounds: version.areas[0].bounds, action: { type: 'LIFF', liffAppCode: 'a' } }] } })).toEqual({ ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' })
  })

  it('starts PUBLISH at CREATE and the idempotent kinds at APPLY', () => {
    expect(initialStage('PUBLISH')).toBe('CREATE')
    expect(initialStage('SET_DEFAULT')).toBe('APPLY')
    expect(initialStage('SET_ALIAS')).toBe('APPLY')
  })

  it('treats an unconfirmed create as UNKNOWN and an unconfirmed idempotent stage as a retry', () => {
    expect(settleOutcome({ stage: 'CREATE', result: { status: 'ACCEPTED_BY_LINE' } })).toBe('ACCEPTED')
    expect(settleOutcome({ stage: 'CREATE', result: { status: 'PERMANENT_FAILURE' } })).toBe('FAILED')
    expect(settleOutcome({ stage: 'CREATE', result: { status: 'UNCONFIRMED' } })).toBe('UNKNOWN')
    expect(settleOutcome({ stage: 'CREATE', result: { status: 'RETRYABLE_FAILURE' } })).toBe('UNKNOWN')
    expect(settleOutcome({ stage: 'UPLOAD', result: { status: 'UNCONFIRMED' } })).toBe('RETRY')
    expect(settleOutcome({ stage: 'APPLY', result: { status: 'RETRYABLE_FAILURE' } })).toBe('RETRY')
    expect(settleOutcome({ stage: 'APPLY', result: { status: 'PERMANENT_FAILURE' } })).toBe('FAILED')
  })

  it('backs off exponentially and caps at one minute', () => {
    expect(retryDelayMs(0)).toBe(1000)
    expect(retryDelayMs(3)).toBe(8000)
    expect(retryDelayMs(10)).toBe(60_000)
  })
})
