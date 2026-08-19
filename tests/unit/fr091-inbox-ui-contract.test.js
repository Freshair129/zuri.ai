import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { DOMAINS, domainForPath } from '@/config/domains'

// @req FR-091 — the CRM domain stops being a reserved slot, its two pages read through
// the one authorized endpoint, and neither of them can reply.
// @spec SDD-049, BR-001, BR-011, SEC-001

const inboxPage = () => readFileSync('src/app/(pm)/customer/conversations/page.jsx', 'utf8')
const dashboardPage = () => readFileSync('src/app/(pm)/customer/page.jsx', 'utf8')

describe('FR-091 CRM domain navigation', () => {
  const crm = () => DOMAINS.find((domain) => domain.key === 'customer')

  it('is no longer reserved, and has a page behind every entry it advertises', () => {
    // `soon: true` means "a slot with nothing behind it" — DomainBar disables it and
    // the command palette hides it. Leaving it set while shipping the pages would
    // build a surface nobody can navigate to.
    expect(crm().soon).toBe(false)
    expect(crm().sub).toContainEqual(expect.objectContaining({ label: 'Dashboard', path: '/customer' }))
    expect(crm().sub).toContainEqual(expect.objectContaining({ label: 'Inbox', path: '/customer/conversations' }))
  })

  it('routes both paths to the CRM domain, not to the Development fallback', () => {
    expect(domainForPath('/customer').key).toBe('customer')
    expect(domainForPath('/customer/conversations').key).toBe('customer')
  })

  it('keeps Dashboard first, the shape every peer domain already has', () => {
    expect(crm().sub[0].label).toBe('Dashboard')
  })
})

describe('FR-091 inbox page contract', () => {
  it('reads through the authorized endpoint and always passes the Business scope', () => {
    const source = inboxPage()
    expect(source).toContain('/api/crm/conversations')
    // The scope is never implicit: an inbox that omitted businessId would be asking
    // the server to guess which tenant it may read.
    expect(source).toMatch(/businessId=\$\{encodeURIComponent\(businessId\)\}/)
  })

  it('cannot reply — BR-011 gives the reply to the runtime that received the message', () => {
    const source = inboxPage()
    // Not a style preference: a console reply would race a ~30s token owned by the
    // edge runtime, making two reply owners of a channel that must have one.
    expect(source).not.toMatch(/method:\s*['"]POST['"]/)
    expect(source).not.toMatch(/<textarea|<form/)
    expect(source).toMatch(/BR-011/)
  })

  it('names the owner of a conversation no Business owns instead of printing a blank', () => {
    expect(inboxPage()).toMatch(/businessName \|\| 'ทั้ง tenant'/)
  })

  it('says the page does not update itself rather than implying that it does', () => {
    const source = inboxPage()
    expect(source).toMatch(/รีเฟรช/)
    expect(source).toMatch(/inbox\.reload/)
  })
})

describe('FR-091 dashboard page contract', () => {
  it('derives its figures from the same endpoint the list uses', () => {
    const source = dashboardPage()
    expect(source).toContain('/api/crm/conversations')
    // A second aggregation endpoint would be a second place for these numbers to be
    // computed, and therefore a second place for them to disagree with the list one
    // click away. Asserted as "exactly one read", not as the absence of a string —
    // prose in this file mentions the endpoint that must not exist, and a text search
    // cannot tell an explanation from a call.
    expect(source.match(/useFetch\(/g)).toHaveLength(1)
  })

  it('links into the Inbox rather than reimplementing the thread view', () => {
    expect(dashboardPage()).toMatch(/href="\/customer\/conversations"/)
  })
})
