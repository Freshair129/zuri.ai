// @req FR-254 — console rendering, pagination, scope isolation and evidence navigation.
// @spec ADR-072, ADR-085, SEC-008
// @tested tests/e2e/fr254-knowledge-console.spec.js
// UI FIXTURE EVIDENCE ONLY: real isolated owner/session and Business scope;
// intercepted knowledge responses do not prove admission, native execution,
// authorization enforcement, publication or retrieval correctness.
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

const capabilities = { admit: true, query: true, reason: null }
const pageData = (items = [], extra = {}) => ({ items, hasMore: false, nextCursor: null, capabilities, ...extra })
const source = (id, title, extra = {}) => ({ id, title, kind: 'TEXT', status: 'QUEUED', sourceVersion: 'v1', projectId: null, createdAt: '2026-09-17T01:00:00Z', ...extra })
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
const flush = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function enterBusiness(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const business = scope.businesses.find((row) => row.code === 'BUS-001')
  const projects = scope.projects.filter((row) => row.businessId === business.id)
  expect(projects.length).toBeGreaterThan(0)
  return { business, projects }
}

async function interceptKnowledge(page, handler) {
  await page.route('**/api/knowledge/**', async (route) => {
    const url = new URL(route.request().url())
    if (await handler(route, url)) return
    await json(route, pageData())
  })
}

test.describe('FR-254 fixture-backed knowledge console', () => {
  test('pages sources and versions, displays every run attempt and generation history', async ({ page }) => {
    await enterBusiness(page)
    const filters = []
    let revoked = false
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname === '/api/knowledge/sources') {
        filters.push(Object.fromEntries(url.searchParams))
        if (revoked) { await json(route, { error: 'Knowledge resource not found' }, 404); return true }
        await json(route, url.searchParams.has('cursor') ? pageData([source('s2', 'Second source')]) : pageData([source('s1', 'First source')], { hasMore: true, nextCursor: 'source-page-2' }))
      } else if (url.pathname === '/api/knowledge/sources/s1') {
        await json(route, pageData(url.searchParams.has('cursor') ? [{ id: 'a0', revision: 1, sourceVersion: 'v0', status: 'SUPERSEDED' }] : [{ id: 'a1', revision: 2, sourceVersion: 'v1', status: 'RUNNING', executionRunId: 'run-one' }], { source: source('s1', 'First source'), hasMore: !url.searchParams.has('cursor'), nextCursor: url.searchParams.has('cursor') ? null : 'version-page-2' }))
      } else if (url.pathname === '/api/knowledge/console/runs/run-one') {
        await json(route, { run: { executionRunId: 'run-one', dataPipelineDefinitionId: 'fixture-pipeline', status: 'RUNNING' }, steps: [
          { executionStepId: 'step-one', pipelineStageId: 'ingest', attemptId: 'attempt-failed', status: 'FAILED', failureCode: 'FIXTURE_TIMEOUT' },
          { executionStepId: 'step-two', pipelineStageId: 'ingest', attemptId: 'attempt-current', status: 'RUNNING' },
        ], gates: [], publication: null, freshness: { stale: true, reason: 'Fixture heartbeat expired' } })
      } else if (url.pathname === '/api/knowledge/corpora') {
        await json(route, pageData([{ id: 'corpus-one', projectId: null, generation: 2, status: 'ACTIVE' }]))
      } else if (url.pathname === '/api/knowledge/corpora/corpus-one/generations') {
        await json(route, pageData([{ id: 'g2', number: 2, published: true, entries: [{ sourceId: 's1', title: 'First source', sourceVersion: 'v1', snapshotId: 'snapshot-exact' }] }], { corpus: { id: 'corpus-one', generation: 2 } }))
      } else return false
      return true
    })
    await page.goto('/knowledge/console')
    const sources = page.getByTestId('console-sources')
    await expect(sources.getByRole('button', { name: 'First source', exact: true })).toBeVisible()
    await sources.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(sources.getByRole('button', { name: 'Second source', exact: true })).toBeVisible()
    await expect(sources.getByText('2 loaded · All matching records loaded')).toBeVisible()
    expect(filters.some((query) => query.cursor === 'source-page-2')).toBe(true)
    await sources.getByLabel('Find source title').fill('First')
    await sources.getByRole('button', { name: 'Filter sources' }).click()
    await expect.poll(() => filters.at(-1)?.q).toBe('First')
    await expect(sources.getByRole('button', { name: 'First source', exact: true })).toBeVisible()
    revoked = true
    await sources.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(sources.getByRole('alert')).toContainText('Knowledge resource not found')
    await expect(sources.getByRole('button', { name: 'First source', exact: true })).toHaveCount(0)
    await expect(sources.getByRole('button', { name: 'Second source', exact: true })).toHaveCount(0)
    revoked = false
    await sources.getByRole('button', { name: 'Retry', exact: true }).click()
    await sources.getByRole('button', { name: 'First source', exact: true }).click()
    const history = page.getByTestId('console-source-detail')
    await history.getByRole('button', { name: 'Load more' }).click()
    await expect(history.getByText('Execution run not bound yet.')).toBeVisible()
    await history.getByRole('button', { name: 'Open run run-one' }).click()
    const run = page.getByTestId('console-run-detail')
    await expect(run).toContainText('attempt-failed')
    await expect(run).toContainText('attempt-current')
    await expect(run).toContainText('FIXTURE_TIMEOUT')
    await expect(run).toContainText('Evidence is stale')
    await expect(run).toContainText('Verified publication not reported.')
    await page.getByRole('button', { name: 'Corpus generations', exact: true }).click()
    await page.getByTestId('console-corpora').getByRole('button', { name: 'Business corpus', exact: true }).click()
    await expect(page.getByTestId('console-generation-detail')).toContainText('snapshot-exact')
    await expect(page.getByTestId('console-generation-detail')).toContainText('Corpus generation 2')
  })

  test('distinguishes failed reads, verified empty data, runtime capability and Files errors', async ({ page }) => {
    await enterBusiness(page)
    let failed = true
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname === '/api/knowledge/sources') {
        await json(route, failed ? { error: 'Fixture source read failed' } : pageData([], { capabilities: { admit: false, query: false, reason: 'Fixture runtime unavailable' } }), failed ? 500 : 200)
      } else if (url.pathname === '/api/knowledge/ingestions') {
        await json(route, { error: 'Fixture admission read failed' }, 503)
      } else return false
      return true
    })
    await page.goto('/knowledge/console')
    await expect(page.getByTestId('console-sources').getByRole('alert')).toContainText('Fixture source read failed')
    await expect(page.getByText('No knowledge sources', { exact: true })).toHaveCount(0)
    failed = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('No knowledge sources', { exact: true })).toBeVisible()
    await expect(page.getByText(/Admission unavailable.*Fixture runtime unavailable/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeDisabled()
    await page.goto('/files')
    const admissionError = page.getByRole('alert').filter({ hasText: 'Could not load knowledge admissions' })
    await expect(admissionError).toContainText('Could not load knowledge admissions')
    await expect(admissionError).toContainText('Fixture admission read failed')
    await expect(page.getByRole('link', { name: 'Knowledge console', exact: true })).toBeVisible()
  })

  test('submits explicit text admission without treating queue acceptance as publication', async ({ page }) => {
    const { business } = await enterBusiness(page)
    let submitted
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname === '/api/knowledge/ingestions' && route.request().method() === 'POST') {
        submitted = route.request().postDataJSON()
        await json(route, { id: 'fixture-admission', status: 'QUEUED', executionRunId: null })
      } else if (url.pathname === '/api/knowledge/sources') {
        await json(route, pageData(submitted ? [source('queued-source', 'Queued fixture')] : []))
      } else return false
      return true
    })
    await page.goto('/knowledge/console')
    await page.getByRole('button', { name: 'Add text', exact: true }).click()
    const form = page.getByTestId('console-admission')
    await form.getByLabel('Source key').fill('fixture-text')
    await form.getByLabel('Source version').fill('v1')
    await form.getByLabel('Title', { exact: true }).fill('Queued fixture')
    await form.getByLabel('Text or Markdown', { exact: true }).fill('Fixture content for admission.')
    await form.getByRole('button', { name: 'Queue admission', exact: true }).click()
    await expect(page.getByRole('status', { name: 'Admission receipt' })).toContainText('fixture-admission')
    expect(submitted).toMatchObject({ businessId: business.id, projectId: null, source: { kind: 'TEXT', sourceKey: 'fixture-text', version: 'v1', title: 'Queued fixture', content: 'Fixture content for admission.' } })
    await expect(page.getByRole('button', { name: 'Queued fixture', exact: true })).toBeVisible()
    await expect(page.getByTestId('console-source-queued-source')).toContainText('QUEUED')
    await expect(page.getByTestId('console-source-queued-source')).not.toContainText('PUBLISHED')
  })

  test('requires one corpus and opens safely rendered exact citation layers at narrow width', async ({ page }) => {
    const { business } = await enterBusiness(page)
    let queryBody
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname === '/api/knowledge/corpora') {
        await json(route, pageData([{ id: 'c1', businessId: business.id, projectId: null, generation: 3, status: 'ACTIVE' }]))
      } else if (url.pathname === '/api/knowledge/queries') {
        queryBody = route.request().postDataJSON()
        await json(route, { corpusId: 'c1', corpusGeneration: 3, results: [{ citationId: 'citation-one', snapshotId: 'snapshot-v1', generation: 1, text: 'Frozen knowledge fixture' }] })
      } else if (url.pathname === '/api/knowledge/citations/citation-one/artifact') {
        const kind = url.searchParams.get('kind')
        const content = `${kind} version 1 <script>window.fixtureExecuted = true</script>`
        if (url.searchParams.get('download') === 'true') {
          await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="fixture-${kind}.txt"`, 'x-content-type-options': 'nosniff' }, body: content })
        } else await json(route, { kind, title: 'Frozen fixture', content, contentHash: `${kind}-hash`, rawArtifactId: 'raw-v1', parsedArtifactId: 'parsed-v1', chunkId: 'chunk-v1', truncated: kind === 'raw', bytes: 100000 })
      } else return false
      return true
    })
    await page.goto('/knowledge/console')
    await page.setViewportSize({ width: 390, height: 844 })
    const searchTab = page.getByRole('button', { name: 'Search knowledge', exact: true })
    await searchTab.focus()
    await page.keyboard.press('Enter')
    const query = page.getByTestId('console-query')
    await expect(query.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
    await query.getByLabel('Search corpus').selectOption('c1')
    await query.getByLabel('Knowledge query').fill('frozen fixture')
    await query.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(query).toContainText('Results from corpus generation 3')
    expect(queryBody).toMatchObject({ businessId: business.id, projectId: null, query: 'frozen fixture' })
    await query.getByRole('button', { name: 'Open evidence' }).click()
    const artifact = page.getByTestId('console-artifact')
    await expect(artifact.getByTestId('console-artifact-content')).toContainText('chunk version 1 <script>')
    await artifact.getByRole('button', { name: 'Parsed document' }).click()
    await expect(artifact.getByTestId('console-artifact-content')).toContainText('parsed version 1')
    await artifact.getByRole('button', { name: 'Original source' }).click()
    await expect(artifact.getByTestId('console-artifact-content')).toContainText('raw version 1')
    await expect(artifact.getByRole('status')).toContainText('Preview truncated')
    expect(await page.evaluate(() => window.fixtureExecuted)).toBeUndefined()
    const download = page.waitForEvent('download')
    await artifact.getByRole('link', { name: 'Download raw' }).click()
    expect((await download).suggestedFilename()).toBe('fixture-raw.txt')
    const bounds = await artifact.boundingBox()
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  })

  test('discards an old source response after switching Project scope', async ({ page }) => {
    const { projects } = await enterBusiness(page)
    let release, seen, settled
    const hold = new Promise((resolve) => { release = resolve })
    const requestSeen = new Promise((resolve) => { seen = resolve })
    const requestSettled = new Promise((resolve) => { settled = resolve })
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname !== '/api/knowledge/sources') return false
      if (!url.searchParams.get('projectId')) {
        seen()
        await hold
        await json(route, pageData([source('old', 'OLD SCOPE MUST NOT APPEAR')]))
        settled()
      } else await json(route, pageData([source('new', 'Selected project source', { projectId: projects[0].id })]))
      return true
    })
    try {
      await page.goto('/knowledge/console')
      await requestSeen
      await page.getByLabel('Project scope').selectOption(projects[0].id)
      await expect(page.getByRole('button', { name: 'Selected project source', exact: true })).toBeVisible()
      release()
      await requestSettled
      await flush(page)
      await expect(page.getByText('OLD SCOPE MUST NOT APPEAR')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Selected project source', exact: true })).toBeVisible()
    } finally { release() }
  })

  test('clears cited results and ignores an in-flight query on a Project scope change', async ({ page }) => {
    const { projects } = await enterBusiness(page)
    let release, seen, settled
    const hold = new Promise((resolve) => { release = resolve })
    const requestSeen = new Promise((resolve) => { seen = resolve })
    const requestSettled = new Promise((resolve) => { settled = resolve })
    await interceptKnowledge(page, async (route, url) => {
      if (url.pathname === '/api/knowledge/corpora') await json(route, pageData([{ id: 'c1', projectId: null, generation: 3, status: 'ACTIVE' }]))
      else if (url.pathname === '/api/knowledge/queries') {
        seen()
        await hold
        await json(route, { corpusGeneration: 3, results: [{ citationId: 'old-citation', text: 'OLD QUERY MUST NOT APPEAR' }] })
        settled()
      } else return false
      return true
    })
    try {
      await page.goto('/knowledge/console')
      await page.getByRole('button', { name: 'Search knowledge', exact: true }).click()
      await page.getByLabel('Search corpus').selectOption('c1')
      await page.getByLabel('Knowledge query').fill('old question')
      await page.getByTestId('console-query').getByRole('button', { name: 'Search', exact: true }).click()
      await requestSeen
      await page.getByLabel('Project scope').selectOption(projects[0].id)
      await expect(page.getByTestId('console-sources')).toBeVisible()
      release()
      await requestSettled
      await flush(page)
      await expect(page.getByText('OLD QUERY MUST NOT APPEAR')).toHaveCount(0)
      await expect(page.getByTestId('console-artifact')).toHaveCount(0)
    } finally { release() }
  })
})
