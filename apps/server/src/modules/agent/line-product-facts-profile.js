import { readMainDevLocalOllamaProfile, assertMainDevLocalOllamaScope } from './main-dev-local-ollama';

// @req FR-291 — trusted test membership, database and scope precede natural fact reads.
// @tested tests/integration/line-product-facts.test.js
const fail = () => Object.assign(new Error('LINE_NATURAL_PRODUCT_FACTS_UNAVAILABLE'), { code: 'LINE_NATURAL_PRODUCT_FACTS_UNAVAILABLE' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function naturalProductFactsScope({ env = process.env, db, job }) {
  if (env.ZURI_LINE_NATURAL_PRODUCT_FACTS_ENABLED !== 'true') throw fail();
  const profile = readMainDevLocalOllamaProfile(env);
  if (!profile) throw fail();
  let products;
  try { products = JSON.parse(env.ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS); } catch { throw fail(); }
  if (!Array.isArray(products) || products.length < 1 || products.length > 8
    || products.some(product => !product || typeof product !== 'object' || Array.isArray(product)
      || Object.keys(product).sort().join(',') !== 'productId,sku'
      || typeof product.productId !== 'string' || !uuid.test(product.productId)
      || typeof product.sku !== 'string' || product.sku.length > 128 || !/^TEST-ONLY-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(product.sku))
    || new Set(products.map(product => product.productId)).size !== products.length
    || new Set(products.map(product => product.sku)).size !== products.length) throw fail();
  await assertMainDevLocalOllamaScope({ profile, db, tenantId: job.tenantId, businessId: job.businessId, accountId: job.accountId });
  return products;
}
