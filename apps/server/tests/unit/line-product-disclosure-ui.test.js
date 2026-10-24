import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

globalThis.React = React

describe('LINE customer product disclosure UI mount', () => {
  const renderAccount = async (status, overrides = {}) => {
    const { AccountCard } = await import('@/modules/line-oa-studio/ui/LineStudioAccountConsole')
    return renderToStaticMarkup(createElement(AccountCard, {
      businessId: 'business-1',
      account: { id: 'account-1', businessId: 'business-1', status,
        displayName: 'Test OA', effectiveStatus: status, knowledgeGrounding: 'GKS_CORPUS',
        executionMode: 'SERVER', runtimeOwner: 'SERVER', serverEnabled: true,
        transportMode: 'CLOUD', archivedAt: null, ...overrides },
    }))
  }

  it('shows product selection and unchecked fields for the stored CONNECTED OA status', async () => {
    const html = await renderAccount('CONNECTED')
    expect(html).toContain('ข้อมูลสินค้าที่อนุญาตให้ลูกค้าเห็น')
    expect(html).toContain('product-disclosure-title-account-1')
    expect(html.match(/<input[^>]*type="checkbox"/g)?.length).toBeGreaterThanOrEqual(8)
  })

  it.each(['DRAFT', 'PAUSED', 'ARCHIVED'])('does not mount approval controls for %s accounts', async (status) => {
    expect(await renderAccount(status)).not.toContain('product-disclosure-title-account-1')
  })

  it.each([
    { serverEnabled: false },
    { transportMode: 'EDGE' },
    { archivedAt: '2026-10-24T00:00:00Z' },
  ])('does not offer approval when the connected account is ineligible: %j', async (overrides) => {
    expect(await renderAccount('CONNECTED', overrides)).not.toContain('product-disclosure-title-account-1')
  })
})

const FIELD_KEYS = [
  'sku', 'nameTh', 'nameEn', 'unit', 'category', 'productFamily', 'dimensionsCm', 'unitWeightKg',
]

const disclosureModule = () => import('@/modules/line-oa-studio/ui/LineProductDisclosureCard')

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body } }
}

function listing(overrides = {}) {
  return {
    products: [{ id: 'product-1', code: 'P-1', name: 'ชาไทย' }],
    sources: [{ id: 'source-1', title: 'Product Master October' }],
    sourcesNextCursor: null,
    policies: [],
    fields: FIELD_KEYS,
    ...overrides,
  }
}

async function makeController(fetchImpl, businessId = 'business-1', accountId = 'account-1') {
  const module = await disclosureModule()
  expect(module.createDisclosureController).toBeTypeOf('function')
  const controller = module.createDisclosureController({
    businessId,
    accountId,
    fetchImpl,
  })
  return { controller, module }
}

async function configureProduct(controller, fields = ['sku']) {
  await controller.load()
  controller.setProductId('product-1')
  controller.setSourceId('source-1')
  for (const field of fields) controller.toggleField(field)
  controller.setReason('อนุมัติข้อมูลที่เลือก')
}

describe('LINE customer product disclosure card', () => {
  it('renders every fixed field unchecked before loading any grant', async () => {
    const module = await disclosureModule()
    expect(module.DISCLOSURE_FIELDS).toEqual(FIELD_KEYS)
    const html = renderToStaticMarkup(createElement(module.default, {
      businessId: 'business-1',
      accountId: 'account-1',
    }))
    const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []

    expect(checkboxes).toHaveLength(FIELD_KEYS.length)
    expect(checkboxes.every(input => !/\bchecked(?:=|\s|>)/.test(input))).toBe(true)
    expect(html).toContain('ราคาและสต็อกต้องได้รับอนุญาตแยกต่างหาก')
  })

  it('previews only the exact selected fields and does not create a grant', async () => {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if (options.method === 'POST') {
        return jsonResponse({
          previewHash: 'preview-abc',
          expectedVersion: 0,
          values: [
            { field: 'sku', value: 'P-1' },
            { field: 'nameEn', value: 'Hidden value outside the selection' },
          ],
          exampleText: 'SKU: P-1',
        })
      }
      return jsonResponse(listing())
    }
    const { controller } = await makeController(fetchImpl)
    await configureProduct(controller, ['sku'])
    expect(controller.setSourceId('unlisted-source')).toBe(false)
    expect(controller.getState().sourceId).toBe('source-1')

    expect(controller.getState().selectedFields).toEqual(['sku'])
    expect(controller.getState().policies).toEqual([])
    expect(await controller.preview()).toBe(true)

    const previewCall = calls.find(call => call.options.method === 'POST')
    expect(previewCall.url).toBe('/api/line-oa/accounts/account-1/product-disclosure')
    expect(JSON.parse(previewCall.options.body)).toEqual({
      action: 'PREVIEW',
      businessId: 'business-1',
      productId: 'product-1',
      sourceId: 'source-1',
      fields: ['sku'],
    })
    expect(controller.getState().preview).toMatchObject({
      previewHash: 'preview-abc',
      values: [{ field: 'sku', value: 'P-1' }],
      exampleText: 'SKU: P-1',
    })
    expect(controller.getState().policies).toEqual([])
    expect(calls.filter(call => call.options.method === 'POST').map(call => JSON.parse(call.options.body).action))
      .toEqual(['PREVIEW'])
  })

  it('keeps missing fields unavailable until they are removed from the selection', async () => {
    let previews = 0
    const fetchImpl = async (_url, options = {}) => {
      if (options.method !== 'POST') return jsonResponse(listing())
      previews += 1
      const body = JSON.parse(options.body)
      return jsonResponse({
        previewHash: `preview-${previews}`,
        expectedVersion: 0,
        values: body.fields.includes('nameTh')
          ? [{ field: 'sku', value: 'P-1' }]
          : [{ field: 'sku', value: 'P-1' }],
        exampleText: 'SKU: P-1',
      })
    }
    const { controller, module } = await makeController(fetchImpl)
    await configureProduct(controller, ['sku', 'nameTh'])
    await controller.preview()

    expect(controller.getState().unavailableFields).toEqual(['nameTh'])
    expect(module.canApproveDisclosure(controller.getState())).toBe(false)
    expect(controller.toggleField('nameTh')).toBe(true)
    expect(controller.getState().selectedFields).toEqual(['sku'])
    expect(module.canPreviewDisclosure(controller.getState())).toBe(true)
    await controller.preview()
    expect(module.canApproveDisclosure(controller.getState())).toBe(true)
  })

  it('allows approval only after a matching preview and sends its version and hash', async () => {
    const posts = []
    const fetchImpl = async (_url, options = {}) => {
      if (options.method !== 'POST') return jsonResponse(listing())
      const body = JSON.parse(options.body)
      posts.push(body)
      if (body.action === 'PREVIEW') {
        return jsonResponse({
          previewHash: 'preview-123',
          expectedVersion: 4,
          values: [{ field: 'sku', value: 'P-1' }],
          exampleText: 'SKU: P-1',
        })
      }
      return jsonResponse({ policy: { productId: 'product-1', enabled: true, version: 5 } })
    }
    const { controller, module } = await makeController(fetchImpl)
    await configureProduct(controller)

    expect(module.canApproveDisclosure(controller.getState())).toBe(false)
    expect(await controller.approve()).toBe(false)
    expect(posts).toEqual([])

    await controller.preview()
    expect(module.canApproveDisclosure(controller.getState())).toBe(true)
    expect(controller.getState().policies).toEqual([])
    expect(await controller.approve()).toBe(true)
    expect(posts).toEqual([
      {
        action: 'PREVIEW', businessId: 'business-1', productId: 'product-1',
        sourceId: 'source-1', fields: ['sku'],
      },
      {
        action: 'APPROVE', businessId: 'business-1', productId: 'product-1',
        sourceId: 'source-1', fields: ['sku'], expectedVersion: 4,
        previewHash: 'preview-123', reason: 'อนุมัติข้อมูลที่เลือก',
      },
    ])
  })

  it('suppresses stale product search responses', async () => {
    let finishOldSearch
    const fetchImpl = (url) => {
      const query = new URL(url, 'http://localhost').searchParams.get('q')
      if (query === 'เก่า') {
        return new Promise(resolveRequest => { finishOldSearch = () => resolveRequest(jsonResponse(listing({
          products: [{ id: 'old-product', code: 'OLD', name: 'เก่า' }],
        }))) })
      }
      return Promise.resolve(jsonResponse(listing({
        products: [{ id: 'new-product', code: 'NEW', name: 'ใหม่' }],
      })))
    }
    const { controller } = await makeController(fetchImpl)

    const oldSearch = controller.setQuery('เก่า')
    const newSearch = controller.setQuery('ใหม่')
    await newSearch
    finishOldSearch()
    await oldSearch

    expect(controller.getState().query).toBe('ใหม่')
    expect(controller.getState().products.map(product => product.id)).toEqual(['new-product'])
  })

  it('searches source titles on the server and clears only the source selection and selected fields', async () => {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if (options.method === 'POST') {
        return jsonResponse({ previewHash: 'source-search-preview', expectedVersion: 0,
          values: [{ field: 'sku', value: 'P-1' }], exampleText: 'SKU: P-1' })
      }
      const params = new URL(url, 'http://localhost').searchParams
      if (params.get('sourceQuery')) {
        return jsonResponse(listing({
          products: [{ id: 'other-product', code: 'OTHER', name: 'อื่น' }],
          sources: [{ id: 'filtered-source', title: 'Authorized current source title' }],
          sourcesNextCursor: 'filtered-source',
          policies: [{ productId: 'other-product', sourceId: 'filtered-source', enabled: false, version: 1 }],
        }))
      }
      return jsonResponse(listing())
    }
    const { controller } = await makeController(fetchImpl)
    await controller.setQuery('ชาไทย')
    controller.setProductId('product-1')
    controller.setSourceId('source-1')
    controller.toggleField('sku')
    expect(await controller.preview()).toBe(true)

    await controller.setSourceQuery('catalog')

    const searchCall = calls.find(call => new URL(call.url, 'http://localhost').searchParams.has('sourceQuery'))
    const params = new URL(searchCall.url, 'http://localhost').searchParams
    expect(params.get('q')).toBe('ชาไทย')
    expect(params.get('sourceQuery')).toBe('catalog')
    expect(params.has('sourceCursor')).toBe(false)
    expect(controller.getState()).toMatchObject({
      query: 'ชาไทย',
      sourceQuery: 'catalog',
      productId: 'product-1',
      sourceId: '',
      selectedFields: [],
      preview: null,
      sourcesNextCursor: 'filtered-source',
    })
    expect(controller.getState().products.map(product => product.id)).toEqual(['product-1'])
    expect(controller.getState().sources).toEqual([{ id: 'filtered-source', title: 'Authorized current source title' }])
    expect(controller.getState().policies).toEqual([])
  })

  it('loads the next source cursor and appends choices without replacing product state or preview', async () => {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      const params = new URL(url, 'http://localhost').searchParams
      if (options.method === 'POST') {
        return jsonResponse({ previewHash: 'page-preview', expectedVersion: 0,
          values: [{ field: 'sku', value: 'P-1' }], exampleText: 'SKU: P-1' })
      }
      if (params.get('sourceCursor')) {
        return jsonResponse(listing({
          products: [{ id: 'other-product', code: 'OTHER', name: 'อื่น' }],
          sources: [{ id: 'source-2', title: 'Product Master November' }],
          sourcesNextCursor: null,
          policies: [{ productId: 'other-product', sourceId: 'source-2', enabled: true, version: 8 }],
        }))
      }
      if (params.get('sourceQuery')) {
        return jsonResponse(listing({
          sources: [{ id: 'source-1', title: 'Product Master October' }],
          sourcesNextCursor: 'source-1',
        }))
      }
      return jsonResponse(listing({ sourcesNextCursor: 'source-1' }))
    }
    const { controller } = await makeController(fetchImpl)
    await controller.load()
    await controller.setSourceQuery('October')
    controller.setProductId('product-1')
    controller.setSourceId('source-1')
    controller.toggleField('sku')
    controller.setReason('อนุมัติข้อมูลที่เลือก')
    await controller.preview()
    const preview = controller.getState().preview

    expect(await controller.loadMoreSources()).toBe(true)

    const nextPage = calls.map(call => new URL(call.url, 'http://localhost').searchParams)
      .find(params => params.has('sourceCursor'))
    expect(nextPage.get('sourceCursor')).toBe('source-1')
    expect(nextPage.get('sourceQuery')).toBe('October')
    expect(controller.getState().sources.map(source => source.id)).toEqual(['source-1', 'source-2'])
    expect(controller.getState()).toMatchObject({
      productId: 'product-1',
      sourceId: 'source-1',
      selectedFields: ['sku'],
      preview,
      sourcesNextCursor: null,
    })
    expect(controller.getState().products.map(product => product.id)).toEqual(['product-1'])
    expect(controller.getState().policies).toEqual([])
  })

  it('suppresses a stale source-cursor response after a newer source search starts', async () => {
    let finishOldPage
    const fetchImpl = (url) => {
      const params = new URL(url, 'http://localhost').searchParams
      if (params.get('sourceCursor') === 'source-1') {
        return new Promise(resolveRequest => { finishOldPage = () => resolveRequest(jsonResponse(listing({
          sources: [{ id: 'stale-source', title: 'Stale page' }],
          sourcesNextCursor: 'stale-cursor',
        }))) })
      }
      if (params.get('sourceQuery') === 'new title') {
        return Promise.resolve(jsonResponse(listing({
          sources: [{ id: 'new-source', title: 'New source' }],
          sourcesNextCursor: null,
        })))
      }
      return Promise.resolve(jsonResponse(listing({ sourcesNextCursor: 'source-1' })))
    }
    const { controller } = await makeController(fetchImpl)
    await controller.load()
    const stalePage = controller.loadMoreSources()

    await controller.setSourceQuery('new title')
    finishOldPage()
    await stalePage

    expect(controller.getState().sourceQuery).toBe('new title')
    expect(controller.getState().sources.map(source => source.id)).toEqual(['new-source'])
    expect(controller.getState().sourcesNextCursor).toBeNull()
  })

  it('resets the preview when account or Business scope changes', async () => {
    let finishOldLoad
    let oldLoadCount = 0
    const old = (await makeController((_url, options = {}) => {
      if (options.method === 'POST') {
        return Promise.resolve(jsonResponse({
          previewHash: 'old-preview', expectedVersion: 0,
          values: [{ field: 'sku', value: 'OLD' }], exampleText: 'SKU: OLD',
        }))
      }
      oldLoadCount += 1
      if (oldLoadCount === 1) {
        return Promise.resolve(jsonResponse(listing({
          products: [{ id: 'old-product', code: 'OLD', name: 'เก่า' }],
        })))
      }
      return new Promise(resolveRequest => {
        finishOldLoad = () => resolveRequest(jsonResponse(listing({
          products: [{ id: 'late-product', code: 'LATE', name: 'ล่าช้า' }],
        })))
      })
    })).controller
    await old.load()
    old.setProductId('old-product')
    old.setSourceId('source-1')
    old.toggleField('sku')
    old.setReason('เหตุผลเดิม')
    await old.preview()
    expect(old.getState().preview).not.toBeNull()
    const pendingOldLoad = old.load()
    old.deactivate()

    const current = (await makeController(
      async () => jsonResponse(listing({
        products: [{ id: 'current-product', code: 'NEW', name: 'ใหม่' }],
      })),
      'business-2',
      'account-2',
    )).controller
    await current.load()
    finishOldLoad()
    await pendingOldLoad

    expect(old.getState().preview).toBeNull()
    expect(old.getState().products.map(product => product.id)).toEqual(['old-product'])
    expect(current.getState().preview).toBeNull()
    expect(current.getState().products.map(product => product.id)).toEqual(['current-product'])
  })

  it('clears a preview and reports a version conflict without approving', async () => {
    const fetchImpl = async (_url, options = {}) => {
      if (options.method !== 'POST') return jsonResponse(listing())
      const body = JSON.parse(options.body)
      if (body.action === 'PREVIEW') {
        return jsonResponse({
          previewHash: 'preview-stale', expectedVersion: 2,
          values: [{ field: 'sku', value: 'P-1' }], exampleText: 'SKU: P-1',
        })
      }
      return jsonResponse({ error: 'VERSION_CONFLICT' }, 409)
    }
    const { controller } = await makeController(fetchImpl)
    await configureProduct(controller)
    await controller.preview()
    expect(await controller.approve()).toBe(false)

    expect(controller.getState().preview).toBeNull()
    expect(controller.getState().error).toContain('ข้อมูลเปลี่ยนแปลงแล้ว')
    expect(controller.getState().policies).toEqual([])
  })

  it('handles the owner-only 404 without guessing the viewer role', async () => {
    const { controller } = await makeController(async () => jsonResponse({ error: 'Not found' }, 404))
    await controller.load()

    expect(controller.getState().error).toContain('ไม่สามารถเข้าถึงการตั้งค่าข้อมูลสินค้า')
    expect(controller.getState().error).not.toMatch(/owner|staff|permission|สิทธิ์/i)
  })

  it('withdraws the selected product policy using its current version and reason', async () => {
    const calls = []
    let listCount = 0
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if (options.method === 'POST') return jsonResponse({ policy: { enabled: false, version: 8 } })
      listCount += 1
      return jsonResponse(listing({ policies: [{
        productId: 'product-1', sourceId: 'source-1', fields: ['sku'],
        enabled: listCount === 1, version: listCount === 1 ? 7 : 8, stale: false,
      }] }))
    }
    const { controller } = await makeController(fetchImpl)
    await controller.load()
    controller.setProductId('product-1')
    controller.setReason('หยุดเผยแพร่สินค้านี้')

    expect(await controller.withdraw()).toBe(true)
    const withdrawal = calls.find(call => call.options.method === 'POST')
    expect(JSON.parse(withdrawal.options.body)).toEqual({
      action: 'WITHDRAW',
      businessId: 'business-1',
      productId: 'product-1',
      expectedVersion: 7,
      reason: 'หยุดเผยแพร่สินค้านี้',
    })
    expect(controller.getState().policies[0]).toMatchObject({ enabled: false, version: 8 })
  })

  it('explains an in-flight send conflict without reporting a successful withdrawal', async () => {
    const { controller } = await makeController(async (_url, options = {}) => options.method === 'POST'
      ? jsonResponse({ error: 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS' }, 409)
      : jsonResponse(listing({ policies: [{ productId: 'product-1', sourceId: 'source-1',
        fields: ['sku'], enabled: true, version: 7, stale: false }] })))
    await controller.load()
    controller.setProductId('product-1')
    controller.setReason('หยุดเผยแพร่สินค้านี้')
    expect(await controller.withdraw()).toBe(false)
    expect(controller.getState().error).toContain('กำลังส่งข้อความ LINE')
    expect(controller.getState().policies[0]).toMatchObject({ enabled: true, version: 7 })
  })
})
