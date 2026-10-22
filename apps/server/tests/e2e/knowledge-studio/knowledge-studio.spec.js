const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { e2eTarget } = require('../e2e-target')
const { E2E_PASSWORD } = require('../e2e-auth')

// @req FR-289 — verify the operator-only indexed graph and Markdown browser.
// @spec ADR-048 D1-D3
// @tested tests/e2e/knowledge-studio/knowledge-studio.spec.js

const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('only an installation operator can open the graph and exact Markdown reader', async ({ page }) => {
  // CI does not redistribute or install the captured renderer. A small, repo-owned
  // fixture covers the bridge protocol; local original-renderer smoke can opt out.
  if (process.env.ZURI_E2E_ORIGINAL_RENDERER !== '1') {
    await page.route('http://127.0.0.1:19860/components**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: readFileSync(path.join(__dirname, 'mock-renderer.html'), 'utf8'),
    }))
  }

  const signup = await page.request.post('/api/auth/signup', {
    headers: { 'x-forwarded-for': '198.51.100.82' },
    data: { email: 'fr289-' + randomUUID() + '@example.test', displayName: 'FR-289 operator', password: E2E_PASSWORD },
  })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()

  const deniedGraph = await page.request.get('/api/control/knowledge-studio/graph')
  expect(deniedGraph.status()).toBe(403)
  const deniedDocument = await page.request.get('/api/control/knowledge-studio/document?nodeId=domain-knowledge')
  expect(deniedDocument.status()).toBe(403)
  await page.goto('/control/knowledge-studio')
  await expect(page).toHaveURL(/\/access-denied$/)

  const grant = await prisma.platformGrant.create({
    data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) },
  })
  grantIds.push(grant.id)

  const graphResponse = await page.request.get('/api/control/knowledge-studio/graph')
  expect(graphResponse.status()).toBe(200)
  const graph = await graphResponse.json()
  expect(graph.dataset.schemaVersion).toBe('dictionary-external-data/v2')
  expect(graph.dataset.nodes.length).toBeGreaterThan(1000)
  expect(graph.counts.edges).toBeGreaterThan(0)
  const sectionIds = new Set(graph.dataset.sections.map((section) => section.id))
  expect(sectionIds).toContain('services')
  expect(sectionIds).toContain('shared')
  expect([...sectionIds].some((id) => id.startsWith('domain-'))).toBe(true)
  expect(graph.dataset.nodes.every((node) => sectionIds.has(node.sectionId))).toBe(true)
  expect(graph.dataset.nodes.some((node) => node.panel?.details?.some((detail) => detail.label === 'Source path' && /^docs\/.+\.md$/.test(detail.value)))).toBe(true)

  const documentResponse = await page.request.get('/api/control/knowledge-studio/document?nodeId=domain-knowledge')
  expect(documentResponse.status()).toBe(200)
  const document = await documentResponse.json()
  expect(document.path).toBe('docs/domains/knowledge/CHARTER.md')
  expect(document.markdown).toContain('# Domain charter')
  expect((await page.request.get('/api/control/knowledge-studio/document?nodeId=unknown-node')).status()).toBe(404)

  await page.goto('/control/knowledge-studio')
  await expect(page.getByRole('heading', { name: 'Knowledge Studio' })).toBeVisible()
  const frame = page.getByTitle('Original Knowledge Graph Studio component')
  await expect(frame).toBeVisible()
  const frameUrl = new URL(await frame.getAttribute('src'))
  expect(frameUrl.origin).toBe('http://127.0.0.1:19860')
  expect(frameUrl.searchParams.get('bridge')).toBe('1')
  expect(frameUrl.searchParams.get('parentOrigin')).toBe(new URL(page.url()).origin)

  // Automatic 3D layout for the live document graph takes longer than the fixed 1k-node fixture.
  test.setTimeout(90000)
  const bridgeStatus = page.locator('[role="status"][data-state]')
  await expect.poll(() => bridgeStatus.getAttribute('data-state'), { timeout: 60000 }).toMatch(/^(ready|error)$/)
  const bridgeMessage = await bridgeStatus.innerText()
  expect(await bridgeStatus.getAttribute('data-state'), bridgeMessage).toBe('ready')
  expect(bridgeMessage).toContain('Connected ·')
  const studio = page.frameLocator('iframe[title="Original Knowledge Graph Studio component"]')
  await expect(studio.locator('#knowledge-shell')).toBeVisible()
  await expect(studio.locator('#graph-node-count')).not.toHaveText('0')
  await expect(studio.locator('#graph-edge-count')).not.toHaveText('0')

  const search = studio.locator('#knowledge-search')
  await search.fill('FR-289')
  const results = studio.locator('#search-results')
  await expect(results).toBeVisible()
  await expect(results).toContainText('FR-289')
  await results.getByRole('button').filter({ hasText: 'FR-289' }).first().click()
  await expect(studio.locator('#document-path')).toHaveText('docs/requirements/FR-289.md')
  await expect(studio.locator('#markdown-content')).toContainText('filter graph nodes by kind and neighbor hops')

  const graphNodeCount = studio.locator('#graph-node-count')
  const graphViewStatus = studio.locator('#graph-view-status')
  const initialVisibleNodes = Number((await graphNodeCount.innerText()).replaceAll(',', ''))
  await studio.locator('#node-kind-filter').selectOption('feature')
  await studio.locator('#apply-view').click()
  await expect.poll(async () => Number((await graphNodeCount.innerText()).replaceAll(',', ''))).toBeLessThan(initialVisibleNodes)
  const featureVisibleNodes = Number((await graphNodeCount.innerText()).replaceAll(',', ''))
  expect(featureVisibleNodes).toBeGreaterThan(0)
  expect(featureVisibleNodes).toBeLessThan(initialVisibleNodes)
  await expect(graphViewStatus).toContainText('nodes')
  await studio.locator('#node-kind-filter').selectOption('all')
  await studio.locator('#hop-filter').selectOption('1')
  await studio.locator('#apply-view').click()
  await expect(graphViewStatus).toContainText('1 hops from')
  const neighborVisibleNodes = Number((await graphNodeCount.innerText()).replaceAll(',', ''))
  expect(neighborVisibleNodes).toBeGreaterThan(0)
  expect(neighborVisibleNodes).toBeLessThan(initialVisibleNodes)
})
