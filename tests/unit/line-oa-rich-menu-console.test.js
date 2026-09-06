import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINE_OA_RICH_MENU_ACTIONS, LINE_OA_RICH_MENU_ACTION_TYPES, LINE_OA_RICH_MENU_LAYOUTS } from '@/lib/validation/enums'
import { DOMAINS } from '@/config/domains'

// @req FR-151 — the rich menu console offers exactly the actions the service
//   implements, and claims nothing beyond them.
// @spec ADR-060 D3, D11, D12 — no clickable surface for a capability that does
//   not exist; a nav entry only for a page that does.
// @tested this file
//
// Client components run under a node test environment with no DOM (see
// audit-page.test.js and integrations-page-claims.test.js), so the shipped
// source is the checkable surface. The point of these assertions is not
// coverage: it is that the page cannot drift into offering a control the lane
// has no code for, which is the defect class the 2026-09-05 console sweep
// existed to remove.

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const shipped = (source) => source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'src/app/(pm)/line-oa/rich-menus/page.jsx'
const SERVICE = 'src/modules/line-oa-studio/application/line-oa-rich-menu-service.js'
const page = shipped(src(PAGE))

describe('the rich menu console offers only the actions the service implements', () => {
  it('sends exactly the three actions the service accepts, and no fourth', () => {
    const sent = [...page.matchAll(/action:\s*'([A-Z_]+)'/g)].map((match) => match[1])
    expect(sent.length).toBeGreaterThan(0)
    expect([...new Set(sent)].sort()).toEqual([...LINE_OA_RICH_MENU_ACTIONS].sort())
  })

  it('offers no control that claims the menu reaches LINE', () => {
    // `applyRichMenuAction` has three branches and none of them calls a
    // transport, so no menu action on this page can reach LINE. Publishing does
    // exist since FR-152, but through a different lane
    // (line-oa-rich-menu-jobs.js + a worker) that this page does not drive —
    // so the page must not imply it drives one, in either direction.
    const service = shipped(src(SERVICE))
    expect(service).not.toMatch(/fetch\(|Transport|api\.line\.me/)
    expect(page).not.toMatch(/rich-menus\/\$\{[^}]*\}\/jobs|\/jobs'/)
    // Look at what a reader can click, not at prose: the page says the words
    // "ไม่ใช่การส่งขึ้น LINE" on purpose, and a blanket text ban would forbid
    // the very sentence that keeps the page honest.
    const buttons = [...page.matchAll(/<button[^>]*>([^<]*)</g)].map((match) => match[1])
    expect(buttons.length).toBeGreaterThan(0)
    for (const label of buttons) {
      expect(label).not.toMatch(/publish|deploy|sync/i)
      expect(label).not.toMatch(/ส่งขึ้น|เผยแพร่/)
    }
    expect(page).not.toMatch(/action:\s*'PUBLISH'/)
  })

  it('says plainly that freezing is not publishing, where an author would look for the button', () => {
    expect(src(PAGE)).toMatch(/Freeze คือการปิดฉบับร่างไม่ให้แก้ไขต่อ ไม่ใช่การส่งขึ้น LINE/)
  })

  it('does not claim the publish capability is missing, only that this page does not drive it', () => {
    // The first version of this page said the system had no such step. FR-152
    // landed one while the page was in review, and a page that denies a
    // capability the product ships is the same defect as one that invents a
    // capability it does not — just pointing the other way.
    const jobs = 'src/modules/line-oa-studio/application/line-oa-rich-menu-jobs.js'
    expect(() => src(jobs)).not.toThrow()
    expect(src(PAGE)).not.toMatch(/ระบบยังไม่มีขั้นตอนนั้น/)
    expect(src(PAGE)).toMatch(/คิวงานแยก \(FR-152\)/)
  })

  it('shows the freeze blockers the service computed instead of deciding readiness itself', () => {
    // `versionDto` fills `issues` for a DRAFT. The page must render that list
    // and gate FREEZE on it, never re-derive readiness from its own rules.
    expect(page).toMatch(/issues/)
    expect(page).toMatch(/blockers\.length > 0/)
    expect(page).not.toMatch(/freezeBlockers|validateRichMenuDraft/)
  })
})

describe('the console reads its vocabulary from the source of truth', () => {
  it('spells out no layout, action type or image size of its own', () => {
    expect(page).toMatch(/LINE_OA_RICH_MENU_LAYOUTS/)
    expect(page).toMatch(/LINE_OA_RICH_MENU_ACTION_TYPES/)
    expect(page).toMatch(/RICH_MENU_IMAGE_SIZES/)
    // A hand-copied list is the thing enums.js exists to prevent.
    for (const layout of LINE_OA_RICH_MENU_LAYOUTS) expect(page).not.toMatch(new RegExp(`'${layout}'`))
    // Action-type literals DO appear, as the render branch of each variant —
    // that mirrors the discriminated union in the domain and is not a copied
    // list. What must not appear is a second enumeration: the dropdown is built
    // from LINE_OA_RICH_MENU_ACTION_TYPES above, so no array literal may list
    // two of them.
    const arrays = [...page.matchAll(/\[[^\]]*\]/g)].map((match) => match[0])
    for (const array of arrays) {
      const listed = LINE_OA_RICH_MENU_ACTION_TYPES.filter((type) => array.includes(`'${type}'`))
      expect(listed.length).toBeLessThan(2)
    }
  })

  it('renders a branch for every action type the enum declares', () => {
    // The inverse guard, and the one that earns its keep: add a type to
    // enums.js and the dropdown grows on its own, silently offering a variant
    // with no fields to fill in. This fails instead.
    for (const type of LINE_OA_RICH_MENU_ACTION_TYPES) {
      expect(page).toMatch(new RegExp(`action\.type === '${type}'|type: '${type}'`))
    }
  })

  it('takes the chat bar limit from the domain rather than a magic number', () => {
    expect(page).toMatch(/RICH_MENU_CHAT_BAR_MAX/)
    expect(page).not.toMatch(/maxLength=\{14\}/)
  })
})

describe('the nav entry matches a page that exists', () => {
  const lineOa = DOMAINS.find((domain) => domain.key === 'line-oa')

  it('lists Rich Menu under LINE OA Studio', () => {
    expect(lineOa.sub.map((item) => item.path)).toContain('/line-oa/rich-menus')
  })

  it('points every LINE OA nav path at a real page file', () => {
    for (const item of lineOa.sub) {
      expect(() => src(`src/app/(pm)${item.path}/page.jsx`)).not.toThrow()
    }
  })
})
