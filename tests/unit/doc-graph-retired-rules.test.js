import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @spec AGENTS.md §18 — a retired id is burnt, never reused and never hidden.
// @tested tests/unit/doc-graph-retired-rules.test.js
//
// `rules anchored in code` excludes retired rules, the same way it already
// excludes 🔜 FRs. That exclusion moves a denominator, so it needs teeth: without
// them, striking out an inconvenient rule would raise the percentage and look
// like progress. These cases are those teeth.

const graph = () => JSON.parse(readFileSync('docs/.doc-graph.json', 'utf8'))
const registry = () => readFileSync('docs/PRD-SDD-v1.0.md', 'utf8')

function rowFor(id) {
  const line = registry().split(/\r?\n/).find((l) => l.startsWith(`| ${id} |`))
  if (!line) throw new Error(`${id} has no registry row`)
  const cells = line.split('|').map((c) => c.trim())
  return { statement: cells[2] || '', status: cells.slice(3).join(' ') }
}

describe('retired rules are excluded honestly', () => {
  const cov = () => graph().stats.coverage

  it('excludes only rules the registry itself struck out or marked retired', () => {
    for (const id of cov().rules_superseded) {
      const { statement, status } = rowFor(id)
      const retired = statement.includes('~~') || /\b(supersed|cancelled|retired)/i.test(status)
      expect(retired, `${id} is excluded from the metric but its row does not retire it`).toBe(true)
    }
  })

  it('makes a retired rule name what governs instead, as a graph edge', () => {
    // The same obligation preflight already puts on a superseded document: a
    // successor, not a deletion. Striking a rule out and walking away would
    // leave the subject it governed unowned. Asserted on the edge rather than
    // the prose, because "what replaced this" has to be answerable from the
    // graph — which is what preflight's lineage guard reads.
    const g = graph()
    for (const id of cov().rules_superseded) {
      const successors = g.edges.filter((e) => e.to === `req:${id}` && e.type === 'supersedes')
      expect(successors.length, `${id} is retired but no successor points at it`).toBeGreaterThan(0)
    }
  })

  it('never reports a rule as both retired and unanchored', () => {
    const both = cov().rules_superseded.filter((id) => cov().rules_without_anchor.includes(id))
    expect(both).toEqual([])
  })

  it('keeps the denominator equal to every live BR/SEC/SDD row', () => {
    // Closes the other way to inflate the number: dropping a rule from the
    // denominator without retiring it in the registry.
    const ids = new Set()
    for (const line of registry().split(/\r?\n/)) {
      const m = line.match(/^\| ((?:BR|SEC|SDD)-\d{3}) \|/)
      if (m) ids.add(m[1])
    }
    const live = [...ids].filter((id) => !cov().rules_superseded.includes(id))
    const denominator = Number(cov().rules_anchored_in_code.match(/\/(\d+)\)/)[1])
    expect(denominator).toBe(live.length)
  })
})
