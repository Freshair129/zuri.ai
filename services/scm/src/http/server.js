import { createServer } from 'node:http'
import { ZodError } from 'zod'

// External SCM API v1 (contracts/v1/scm-api.v1.json). Thin: parse, verify the
// delegated scope, hand ONE business command or query to the application, map
// the outcome. No generic CRUD, no SQL, no executeAnything.
//
// Outcome classes a caller must tell apart:
//   4xx retryable:false  validation / denial / stale version → do not resend as-is
//   409 retryable:true   concurrency loss before any effect → resend is safe
//   503 retryable:true   store busy / draining, no effect → resend is safe
//   network loss / 5xx   UNKNOWN outcome → GET /v1/operations/... with the SAME key,
//                        never a blind resend with a new key.

const route = (method, pattern, name) => ({ method, name, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`) })
const ROUTES = [
  route('GET', '/healthz', 'health'),
  route('GET', '/readyz', 'ready'),
  route('POST', '/v1/procurement/suppliers', 'supplier.create'),
  route('POST', '/v1/procurement/purchase-orders', 'po.create'),
  route('GET', '/v1/procurement/purchase-orders/:id', 'po.get'),
  route('POST', '/v1/procurement/purchase-orders/:id/actions', 'po.action'),
  route('POST', '/v1/procurement/purchase-orders/:id/receipts', 'grn.post'),
  route('POST', '/v1/procurement/cost-sheets/preview', 'costsheet.preview'),
  route('POST', '/v1/procurement/cost-sheets/commit', 'costsheet.commit'),
  route('GET', '/v1/procurement/cost-sheets', 'costsheet.list'),
  route('GET', '/v1/procurement/cost-sheets/:id', 'costsheet.get'),
  route('POST', '/v1/commerce/pos/checkout', 'pos.checkout'),
  route('GET', '/v1/commerce/pos/catalogue', 'pos.catalogue'),
  route('POST', '/v1/commerce/orders', 'order.create'),
  route('GET', '/v1/commerce/orders', 'order.list'),
  route('GET', '/v1/commerce/revenue', 'revenue'),
  route('POST', '/v1/commerce/orders/:id/actions', 'order.action'),
  route('GET', '/v1/commerce/orders/:id', 'order.get'),
  route('GET', '/v1/commerce/orders/:id/payments', 'order.payments'),
  route('POST', '/v1/commerce/orders/:id/payments', 'payment.record'),
  route('GET', '/v1/commerce/payments/:id', 'payment.get'),
  route('POST', '/v1/commerce/payments/:id/actions', 'payment.action'),
  route('GET', '/v1/commerce/pricing-rules', 'pricing.list'),
  route('POST', '/v1/commerce/pricing-rules', 'pricing.create'),
  route('GET', '/v1/commerce/pricing-rules/active', 'pricing.active'),
  route('POST', '/v1/commerce/pricing-rules/preview', 'pricing.preview'),
  route('POST', '/v1/commerce/pricing-rules/calculate', 'pricing.calculate'),
  route('PATCH', '/v1/commerce/pricing-rules/:id', 'pricing.update'),
  route('POST', '/v1/commerce/pricing-rules/:id/actions', 'pricing.action'),
  route('POST', '/v1/inventory/categories', 'catalog.category.create'),
  route('GET', '/v1/inventory/categories', 'catalog.categories.list'),
  route('POST', '/v1/inventory/families', 'catalog.family.create'),
  route('GET', '/v1/inventory/families', 'catalog.families.list'),
  route('POST', '/v1/inventory/factories', 'catalog.factory.create'),
  route('GET', '/v1/inventory/factories', 'catalog.factories.list'),
  route('POST', '/v1/inventory/product-masters', 'catalog.product-master.create'),
  route('GET', '/v1/inventory/product-masters', 'catalog.product-masters.list'),
  route('POST', '/v1/inventory/products', 'catalog.product.create'),
  route('GET', '/v1/inventory/products', 'catalog.products.list'),
  route('POST', '/v1/inventory/bundles', 'catalog.bundle.create'),
  route('GET', '/v1/inventory/bundles', 'catalog.bundles.list'),
  route('GET', '/v1/inventory/products/:id', 'catalog.product.get'),
  route('POST', '/v1/inventory/products/:id/actions', 'catalog.product.action'),
  route('GET', '/v1/inventory/stock', 'stock'),
  route('GET', '/v1/inventory/movements', 'movements'),
  route('GET', '/v1/operations/:action/:key', 'operation'),
]
const COMMAND_OF = { 'supplier.create': 'procurement.supplier.create', 'po.create': 'procurement.purchase-order.create', 'po.action': 'procurement.purchase-order.action', 'grn.post': 'procurement.goods-receipt.post', 'catalog.category.create': 'inventory.category.create', 'catalog.family.create': 'inventory.family.create', 'catalog.factory.create': 'inventory.factory.create', 'catalog.product-master.create': 'inventory.product-master.create', 'catalog.product.create': 'inventory.product.create', 'catalog.bundle.create': 'inventory.bundle.create', 'catalog.product.action': 'inventory.product.action', 'costsheet.preview': 'procurement.cost-sheet.preview', 'costsheet.commit': 'procurement.cost-sheet.commit', 'pos.checkout': 'commerce.pos.checkout', 'order.create': 'commerce.sales-order.create', 'order.action': 'commerce.sales-order.action', 'payment.record': 'commerce.payment.record', 'payment.action': 'commerce.payment.action', 'pricing.create': 'commerce.pricing-rule.create', 'pricing.update': 'commerce.pricing-rule.update', 'pricing.action': 'commerce.pricing-rule.action', 'pricing.calculate': 'commerce.pricing.calculate' }

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function errorBody(error) {
  if (error instanceof ZodError) return [422, { error: { code: 'SCM_VALIDATION_FAILED', message: 'request does not match the contract', retryable: false, issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }]
  const status = Number.isInteger(error?.status) ? error.status : 500
  if (status >= 500 && !error.retryable) return [500, { error: { code: 'SCM_INTERNAL', message: 'internal error; outcome unknown — look up the operation by its key', retryable: false, outcome: 'UNKNOWN' } }]
  const code = error.code ?? (/^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'SCM_ERROR')
  return [status, { error: { code, message: error.code ?? error.message, retryable: Boolean(error.retryable), ...(error.details ? { details: error.details } : {}) } }]
}

async function readJson(req, limit) {
  const type = req.headers['content-type'] ?? ''
  if (!/^application\/json\b/i.test(type)) throw Object.assign(new Error('json only'), { status: 415, code: 'SCM_UNSUPPORTED_MEDIA_TYPE' })
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413, code: 'SCM_PAYLOAD_TOO_LARGE' })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') } catch { throw Object.assign(new Error('bad json'), { status: 400, code: 'SCM_MALFORMED_JSON' }) }
}

export function createScmHttpServer({ config, store, bus, verify, log = () => {} }) {
  let draining = false
  const server = createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url, 'http://scm.local')
    const match = ROUTES.map((r) => ({ r, m: r.method === req.method ? r.re.exec(url.pathname) : null })).find((x) => x.m)
    let status = 500
    try {
      if (!match) throw Object.assign(new Error('not found'), { status: 404, code: 'SCM_ROUTE_NOT_FOUND' })
      const { name } = match.r
      const params = match.m.groups ?? {}
      if (name === 'health') { status = 200; return send(res, 200, { status: 'ok', service: 'scm' }) }
      if (name === 'ready') {
        const ok = !draining && await store.ping().catch(() => false)
        status = ok ? 200 : 503
        return send(res, status, { status: ok ? 'ready' : draining ? 'draining' : 'store-unavailable', store: store.kind })
      }
      if (draining) throw Object.assign(new Error('draining'), { status: 503, code: 'SCM_DRAINING', retryable: true })
      const auth = req.headers.authorization ?? ''
      if (!auth.startsWith('Delegation ')) throw Object.assign(new Error('delegation required'), { status: 401, code: 'SCM_DELEGATION_REQUIRED' })
      const scope = verify(auth.slice('Delegation '.length))
      let body
      if (name === 'pricing.preview') {
        // A POST that is a query: evaluates, stores nothing, needs no key.
        status = 200
        return send(res, 200, await bus.queries.pricingPreview(scope, await readJson(req, config.maxBodyBytes)))
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        body = await readJson(req, config.maxBodyBytes)
        const result = await bus.run(scope, COMMAND_OF[name], { idempotencyKey: req.headers['idempotency-key'], targetId: params.id ?? null, body })
        status = result.replayed ? 200 : 201
        return send(res, status, result)
      }
      let result
      if (name === 'po.get') result = await bus.queries.purchaseOrder(scope, params.id)
      else if (name === 'order.get') result = await bus.queries.salesOrder(scope, params.id)
      else if (name === 'revenue') {
        const p = url.searchParams
        result = await bus.queries.revenue(scope, { businessId: p.get('businessId'), ...(p.get('from') ? { from: p.get('from') } : {}), ...(p.get('to') ? { to: p.get('to') } : {}) })
      } else if (name === 'order.list') {
        const p = url.searchParams
        const bool = (v) => (v === null ? undefined : v === 'true')
        result = await bus.queries.orders(scope, Object.fromEntries(Object.entries({ businessId: p.get('businessId'), status: p.get('status') ?? undefined, includeClosed: bool(p.get('includeClosed')), origin: p.get('origin') ?? undefined, customerId: p.get('customerId') ?? undefined, conversationId: p.get('conversationId') ?? undefined, limit: p.get('limit') ? Number(p.get('limit')) : undefined }).filter(([, v]) => v !== undefined)))
      }
      else if (name === 'order.payments') result = await bus.queries.orderPayments(scope, params.id)
      else if (name === 'payment.get') result = await bus.queries.payment(scope, params.id)
      else if (name.startsWith('catalog.') && name.endsWith('.list')) {
        const p = url.searchParams
        const query = Object.fromEntries([...p.entries()].filter(([k]) => ['businessId', 'categoryId', 'nature', 'productMasterId', 'stockPolicy', 'status', 'includeArchived'].includes(k)).map(([k, v]) => [k, k === 'includeArchived' ? v === 'true' : v]))
        const which = { 'catalog.categories.list': 'categories', 'catalog.families.list': 'families', 'catalog.factories.list': 'factories', 'catalog.product-masters.list': 'productMasters', 'catalog.products.list': 'products', 'catalog.bundles.list': 'bundles' }[name]
        result = { [which]: await bus.queries[which](scope, query) }
      } else if (name === 'catalog.product.get') result = await bus.queries.product(scope, params.id)
      else if (name === 'pos.catalogue') result = await bus.queries.posCatalogue(scope, { businessId: url.searchParams.get('businessId') })
      else if (name === 'costsheet.get') result = await bus.queries.costSheet(scope, params.id)
      else if (name === 'costsheet.list') {
        const p = url.searchParams
        result = await bus.queries.costSheets(scope, Object.fromEntries(Object.entries({ businessId: p.get('businessId'), supplierId: p.get('supplierId') || undefined, status: p.get('status') || undefined, limit: p.get('limit') || undefined }).filter(([, v]) => v !== undefined)))
      } else if (name === 'pricing.list') result = await bus.queries.pricingRules(scope, { businessId: url.searchParams.get('businessId') })
      else if (name === 'pricing.active') result = await bus.queries.activePricingRule(scope, url.searchParams.get('businessId'))
      else if (name === 'stock') result = await bus.queries.stock(scope, url.searchParams.get('businessId'))
      else if (name === 'movements') result = await bus.queries.movements(scope, { businessId: url.searchParams.get('businessId'), productId: url.searchParams.get('productId') || undefined, limit: url.searchParams.get('limit') })
      else if (name === 'operation') result = await bus.lookup(scope, { action: decodeURIComponent(params.action), businessId: url.searchParams.get('businessId'), idempotencyKey: decodeURIComponent(params.key) })
      status = 200
      return send(res, 200, result)
    } catch (error) {
      const [code, body] = errorBody(error)
      status = code
      if (code >= 500) log('error', 'request failed', { path: url.pathname, code: body.error.code, error: error?.code ?? error?.name })
      if (!res.headersSent) send(res, code, body)
    } finally {
      // Paths only: no body, no delegation token, no prices in logs.
      log('info', 'request', { method: req.method, path: match ? match.r.name : 'unmatched', status, ms: Date.now() - started })
    }
  })
  server.requestTimeout = config.requestTimeoutMs
  server.headersTimeout = Math.min(config.requestTimeoutMs, 10000)

  return {
    listen: (port = config.port, host = config.host) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => resolve(server.address()))
    }),
    /** Stop admitting work; let in-flight requests finish; then close. */
    close: () => new Promise((resolve) => {
      draining = true
      server.close(() => resolve())
      server.closeIdleConnections?.()
    }),
  }
}
