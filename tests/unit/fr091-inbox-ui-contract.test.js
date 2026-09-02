import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { DOMAINS, domainForPath } from '@/config/domains'

// @req FR-091 — the CRM domain stops being a reserved slot, its two pages read through
// the one authorized endpoint, and neither of them can reply.
// @req FR-103 — the inbox page's one write is the SEC-005 consent attestation, never
// a reply; covered here rather than in a new file since it is the same "what can
// this page's fetches do" contract FR-091's tests already hold.
// @spec SDD-050, SDD-053, BR-001, BR-011, SEC-001, SEC-005

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
    expect(source).not.toMatch(/<textarea|<form/)
    expect(source).toMatch(/BR-011/)
  })

  it('the POSTs this page makes are the two PDPA controls, never a reply', () => {
    const source = inboxPage()
    // Exactly two POSTs in the whole file, and they name the consent and erasure
    // endpoints — proves by elimination that no fetch to /api/crm/conversations (the
    // reply-shaped endpoint) is ever a POST, without a regex fragile enough to trip
    // on the parens inside `encodeURIComponent(...)`.
    expect(source.match(/method:\s*['"]POST['"]/g)).toHaveLength(2)
    expect(source).toContain('/api/crm/customers/${encodeURIComponent(customer.id)}/consent')
    expect(source).toContain('/api/crm/customers/${encodeURIComponent(customer.id)}/erasure')
    expect(source).toMatch(/SEC-005/)
  })

  // @req FR-022 — the erasure affordance. Asserted at the source level for the same
  // reason the rest of this file is: what matters is which endpoint the page may
  // call and under what gate, not how the panel is styled.
  it('gates the FR-022 erasure action on the same per-Business OWNER grant', () => {
    const source = inboxPage()
    // The control renders nothing at all for a non-owner. A destructive button that
    // exists only to be refused invites the click that the refusal then has to catch.
    expect(source).toMatch(/function ErasureControl[\s\S]*?if \(!isOwner\) return null/)
    expect(source).toMatch(/<ErasureControl/)
  })

  it('makes the owner type the confirmation word before the erasure can be sent', () => {
    const source = inboxPage()
    // The literal is sent verbatim from what was typed — the button is disabled until
    // it matches, and the server checks it again. A client-side `confirmation: 'ERASE'`
    // constant would make the dialog decorative.
    expect(source).toContain("const ERASE_CONFIRMATION = 'ERASE'")
    expect(source).toContain('confirmation: typed')
    expect(source).toMatch(/disabled=\{busy \|\| typed !== ERASE_CONFIRMATION\}/)
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
