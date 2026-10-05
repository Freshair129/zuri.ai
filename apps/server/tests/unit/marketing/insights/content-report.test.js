import { describe, expect, it } from 'vitest'
import {
  filterByType, inPublishWindow, summarizeContent, rankTopContent, formatBreakdown, safePermalink, safeThumbnail,
} from '@/modules/marketing/insights/domain/content-report'
import { contentItem } from '../../../fixtures/marketing-insights/fixture-insights-repository'

const items = [
  contentItem({ contentId: 'fx-c1', providerPostId: 'fx-p1', contentType: 'post', format: 'photo', views: 300, publishedAt: '2026-09-10T05:00:00.000Z' }),
  contentItem({ contentId: 'fx-c2', providerPostId: 'fx-p2', contentType: 'reel', format: 'video', views: 900, publishedAt: '2026-09-11T05:00:00.000Z' }),
  contentItem({ contentId: 'fx-c3', providerPostId: 'fx-p3', contentType: 'story', format: 'photo', views: 300, publishedAt: '2026-09-12T05:00:00.000Z' }),
  contentItem({ contentId: 'fx-c4', providerPostId: 'fx-p4', contentType: 'unknown', format: 'unknown', views: null, publishedAt: '2026-09-13T05:00:00.000Z' }),
]

describe('content filter and cohort', () => {
  it('filters by content type; unknown types appear only under all', () => {
    expect(filterByType(items, 'reel').map((item) => item.contentId)).toEqual(['fx-c2'])
    expect(filterByType(items, 'all')).toHaveLength(4)
    expect(filterByType(items, 'live')).toEqual([])
    expect(() => filterByType(items, 'video')).toThrow()
  })

  it('assigns the publish cohort by the Bangkok calendar day', () => {
    const late = contentItem({ contentId: 'fx-late', publishedAt: '2026-09-20T17:30:00.000Z' }) // 2026-09-21 00:30 Bangkok
    expect(inPublishWindow([late], { from: '2026-09-01', to: '2026-09-20' })).toEqual([])
    expect(inPublishWindow([late], { from: '2026-09-21', to: '2026-09-21' })).toHaveLength(1)
  })
})

describe('content summary', () => {
  it('sums only when every item has the metric; reports how many are missing', () => {
    const { summary, quality } = summarizeContent(items)
    expect(summary.views).toBeNull()
    expect(quality.views).toMatchObject({ missing: 1, reasonCode: 'ITEM_METRIC_MISSING', itemCount: 4 })
    expect(summarizeContent(items.slice(0, 3)).summary.views).toBe(1500)
  })

  it('an empty cohort is an observed zero with no items', () => {
    expect(summarizeContent([]).summary.views).toBe(0)
  })
})

describe('top content', () => {
  it('ranks by views, unknown last, then newest, then id — a stable total order', () => {
    const ranked = rankTopContent(items)
    expect(ranked.map((row) => row.contentId)).toEqual(['fx-c2', 'fx-c3', 'fx-c1', 'fx-c4'])
    expect(ranked[0]).toMatchObject({ rank: 1, postId: 'fx-p2', views: 900 })
  })

  it('bounds the limit', () => {
    expect(rankTopContent(items, { limit: 2 })).toHaveLength(2)
    expect(rankTopContent(items, { limit: 999 })).toHaveLength(4)
  })

  it('drops unsafe permalinks and thumbnails without touching the numbers', () => {
    const hostile = contentItem({ contentId: 'fx-h', permalink: 'javascript:alert(1)', thumbnailUrl: 'https://evil.example/x.png' })
    const [row] = rankTopContent([hostile])
    expect(row).toMatchObject({ permalink: null, thumbnailUrl: null, views: 100 })
    expect(safePermalink('http://www.facebook.com/x')).toBeNull()
    expect(safePermalink('https://www.facebook.com.evil.example/x')).toBeNull()
    expect(safePermalink('https://user:pw@www.facebook.com/x')).toBeNull()
    expect(safeThumbnail('https://scontent.xx.fbcdn.net/a.jpg')).toBe('https://scontent.xx.fbcdn.net/a.jpg')
  })
})

describe('format breakdown', () => {
  it('counts unique published items and compares against the prior cohort', () => {
    const current = items.slice(0, 3)
    const previous = [contentItem({ contentId: 'fx-old', format: 'photo', views: 200 })]
    const byFormat = formatBreakdown(current, previous)
    const published = byFormat.find((entry) => entry.metric === 'published').breakdown
    expect(published).toEqual([
      expect.objectContaining({ label: 'photo', value: 2, previousValue: 1, changePct: 100 }),
      expect.objectContaining({ label: 'video', value: 1, previousValue: 0, changePct: null, changeReasonCode: 'PRIOR_ZERO' }),
    ])
    const views = byFormat.find((entry) => entry.metric === 'views').breakdown
    expect(views.find((row) => row.label === 'photo')).toMatchObject({ value: 600, previousValue: 200, changePct: 200 })
  })

  it('does not double count a content id that appears twice', () => {
    const dup = [items[0], { ...items[0] }]
    const published = formatBreakdown(dup, []).find((entry) => entry.metric === 'published').breakdown
    expect(published[0].value).toBe(1)
  })
})
