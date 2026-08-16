// Human views generated from the doc graph (ADR-025 rev 2): agents query the
// graph; people read projections of it. Both views carry blindness assertions
// in doc-preflight — a generated view is only trustworthy if a check proves it
// saw its inputs (.brain/rca/2026-08-16-code-doc-drift-stale-inventories.md).

// @spec docs/decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md
// @tested tests/unit/doc-views.test.js

const banner = (title, tagline) => `# ${title}

| Field | Value |
|-------|-------|
| **Status** | Auto-generated |
| **Generator** | \`scripts/doc-graph.mjs\` (via doc-views) |

> ${tagline}
> Never hand-edit — regenerate with \`npm run docs:graph\`.

`

/** One section per domain: the lane, what it owns, what lives in it. */
export function domainMap(nodes, edges) {
  const domains = nodes.filter((n) => n.type === 'domain').sort((a, b) => a.id.localeCompare(b.id))
  const sections = domains.map((d) => {
    const name = d.id.slice('domain:'.length)
    const routes = edges.filter((e) => e.type === 'owned_by' && e.to === d.id && e.from.startsWith('route:'))
    const api = routes.filter((r) => r.from.startsWith('route:api:')).length
    const pages = routes.filter((r) => r.from.startsWith('route:page:')).length
    const codeInLane = nodes.filter(
      (n) => n.type === 'code_file' && (d.modules || []).some((m) => n.path.startsWith(`src/modules/${m}/`)),
    )
    const frs = new Set()
    for (const c of codeInLane)
      for (const e of edges) if (e.from === c.id && e.type === 'implements') frs.add(e.to.slice('req:'.length))
    const models = d.owns_models || []
    return [
      `## ${name}`,
      '',
      `Charter: [${d.path}](${d.path.replace(/^docs\//, '')})`,
      '',
      '| | |',
      '|---|---|',
      `| Modules | ${(d.modules || []).map((m) => `\`src/modules/${m}\``).join(', ')} |`,
      `| Models owned | ${models.length ? models.join(', ') : '— (state lives outside the shared schema by design)'} |`,
      `| Routes owned | ${routes.length} (${api} api · ${pages} pages) |`,
      `| FRs implemented in lane | ${frs.size ? [...frs].sort().join(', ') : '—'} |`,
      '',
    ].join('\n')
  })
  return (
    banner(
      'Domain Map',
      'One section per domain: the lane, what it owns, and what lives in it — generated from the charters and the graph (ADR-025).',
    ) + sections.join('\n')
  )
}

/** The full chain per FR: surface → code → rules → tests → feature. */
export function traceView(nodes, edges) {
  const featsByFr = new Map()
  for (const f of nodes.filter((n) => n.type === 'feature')) {
    for (const e of edges) {
      if (e.from === f.id && e.type === 'bundles') {
        const fr = e.to.slice('req:'.length)
        if (!featsByFr.has(fr)) featsByFr.set(fr, [])
        featsByFr.get(fr).push(`${f.id.slice('feat:'.length)} — ${f.label}`)
      }
    }
  }
  const routeByPath = new Map(nodes.filter((n) => n.type === 'route').map((n) => [n.path, n]))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const frs = nodes
    .filter((n) => n.type === 'requirement' && n.family === 'FR')
    .sort((a, b) => a.id.localeCompare(b.id))
  const blocks = frs.map((r) => {
    const fid = r.id.slice('req:'.length)
    const code = edges.filter((e) => e.to === r.id && e.type === 'implements').map((e) => e.from.slice('code:'.length))
    const tests = [...new Set(edges.filter((e) => e.to === r.id && e.type === 'verifies').map((e) => e.from.slice('test:'.length)))]
    const routes = code.map((c) => routeByPath.get(c)).filter(Boolean)
    const specs = new Set()
    for (const c of code) for (const s of byId.get(`code:${c}`)?.annotations?.['@spec'] || []) specs.add(s)
    const lines = [`### ${fid} — ${r.label}`, '']
    const feats = featsByFr.get(fid)
    if (feats) lines.push(`- **Feature:** ${feats.join(' · ')}`)
    lines.push(`- **Status:** ${r.declared}`)
    if (routes.length) lines.push(`- **Surface:** ${routes.map((rt) => `\`${rt.route}\` (${rt.kind})`).join(' · ')}`)
    lines.push(`- **Code:** ${code.length ? code.map((c) => `\`${c}\``).join(' · ') : '—'}`)
    lines.push(`- **Follows:** ${specs.size ? [...specs].sort().join(', ') : '—'}`)
    lines.push(`- **Tests:** ${tests.length ? tests.map((t) => `\`${t}\``).join(' · ') : '—'}`)
    lines.push('')
    return lines.join('\n')
  })
  return (
    banner(
      'Trace',
      'The full chain per functional requirement: which surface renders it, which code implements it, which rules it follows, which tests prove it, which feature bundles it.',
    ) + blocks.join('\n')
  )
}
