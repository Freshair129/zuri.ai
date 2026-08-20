import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inventorySectionCaption } from '@/app/(pm)/projects/[projectId]/inventory/page'

// @req FR-077 — a truncated Project Inventory section says so.
// @spec SDD-045
// @tested tests/unit/project-inventory-ui.test.js
//
// The defect: the Workstreams card header read "7 shown" (the read model's
// honest collection count) while the card body rendered only 5 rows
// (`sections.work.workstreams.items.slice(0, 5)`) — two workstreams were
// silently unreachable, and unlike the sibling Work items card there was no
// "Open all …" way to see them. `inventorySectionCaption` is the pure piece
// of that fix: it makes a card's *second*, display-only truncation (on top of
// the read model's own pagination) show up in the caption a reader sees.

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('inventorySectionCaption', () => {
  it('reports the full count when nothing is previewed away', () => {
    expect(inventorySectionCaption(5, undefined)).toEqual({ displayTruncated: false, caption: '5 shown' })
  })

  it('reports the full count when the preview cap already covers everything', () => {
    expect(inventorySectionCaption(5, 5)).toEqual({ displayTruncated: false, caption: '5 shown' })
    expect(inventorySectionCaption(3, 5)).toEqual({ displayTruncated: false, caption: '3 shown' })
  })

  it('names both numbers when the card previews fewer rows than the collection holds', () => {
    // The regression case: 7 workstreams, only 5 rendered.
    expect(inventorySectionCaption(7, 5)).toEqual({ displayTruncated: true, caption: '5 of 7 shown' })
  })

  it('treats a zero-row collection as untruncated', () => {
    expect(inventorySectionCaption(0, 5)).toEqual({ displayTruncated: false, caption: '0 shown' })
  })
})

describe('Project Inventory — Workstreams card tells the truth about what it shows', () => {
  const page = src('src/app/(pm)/projects/[projectId]/inventory/page.jsx')

  it('gives the Workstreams card the same disclosure the Work items card already has', () => {
    const start = page.indexOf('title="Workstreams"')
    const section = page.slice(start, page.indexOf('</InventorySection>', start))
    expect(section).toContain('previewCount={5}')
    // Same escape hatch pattern as the sibling Work items card's "Open all work →".
    expect(section).toContain('moreHref=')
    expect(section).toContain('Open all workstreams')
  })

  it('every card that previews a slice of its collection declares that preview count', () => {
    // A card whose body does `.slice(0, N)` but never tells InventorySection
    // about N is exactly how the header and the body parted company before.
    const sliceCalls = [...page.matchAll(/sections\.(\S+?)\.items\.slice\(0, (\d+)\)/g)]
    expect(sliceCalls.length).toBeGreaterThan(0)
    for (const [, , count] of sliceCalls) {
      expect(page).toContain(`previewCount={${count}}`)
    }
  })
})
