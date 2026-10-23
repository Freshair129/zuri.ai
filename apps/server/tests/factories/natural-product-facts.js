import path from 'node:path';

// @req FR-291 — SQLite substitutes database identity only; PostgreSQL uses its real identity.
// @tested tests/integration/line-product-facts.test.js, tests/integration/conversation-runtime-product-facts-vertical.test.js
function sqliteIdentityDb(db) {
  return new Proxy(db, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property === '$queryRaw') return (query, ...args) => String(query).includes('current_database()')
      ? Promise.resolve([{ databaseName: 'natural_sqlite_fixture' }]) : value.call(target, query, ...args);
    if (property === '$transaction' && typeof value === 'function') return (input, ...args) => typeof input === 'function'
      ? value.call(target, tx => input(sqliteIdentityDb(tx)), ...args) : value.call(target, input, ...args);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export async function naturalProductFactsFixture({ db, business, accounts, product }) {
  const postgres = /^postgres(?:ql)?:/u.test(process.env.DATABASE_URL ?? '');
  const databaseName = postgres ? (await db.$queryRaw`SELECT current_database() AS "databaseName"`)[0].databaseName : 'natural_sqlite_fixture';
  return {
    db: postgres ? db : sqliteIdentityDb(db),
    env: {
      ZURI_LINE_NATURAL_PRODUCT_FACTS_ENABLED: 'true',
      ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS: JSON.stringify([{ productId: product.id, sku: product.code }]),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true', ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: databaseName,
      ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH: path.resolve('test-natural-fixture.json'),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256: 'a'.repeat(64),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([business.tenantId]),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([business.id]),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify(accounts.map(account => account.id)),
    },
  };
}
