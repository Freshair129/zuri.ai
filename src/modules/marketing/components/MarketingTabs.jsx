'use client'

// @req FR-153 — Strategy sections are addressable and preserve Back/reload state.
// @spec SDD-086 — one URL-selected section bar, with no nested tab layer.
// @tested tests/unit/marketing-strategy-ui.test.js

import Link from 'next/link'
import { useRef } from 'react'

export function MarketingTabs({ tabs, activeKey, hrefForTab, ariaLabel = 'Marketing sections' }) {
  const linksRef = useRef([])
  const move = (event, index) => {
    const key = event.key
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return
    event.preventDefault()
    const next = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    linksRef.current[next]?.focus()
    linksRef.current[next]?.click()
  }
  return (
    <nav aria-label={ariaLabel} className="mb-5 overflow-x-auto border-b border-[var(--border)]">
      <div role="tablist" className="flex min-w-max gap-1">
        {tabs.map((tab, index) => {
          const active = tab.key === activeKey
          return (
            <Link
              key={tab.key}
              ref={(node) => { linksRef.current[index] = node }}
              href={hrefForTab(tab.key)}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => move(event, index)}
              className={`border-b-2 px-3 py-2 text-xs font-semibold transition ${active ? 'border-[var(--action-primary)] text-[var(--action-primary)]' : 'border-transparent text-muted hover:border-[var(--border)] hover:text-[var(--ink)]'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-primary)]`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
