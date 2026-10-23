import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { naturalProductFactsScope } from '@/modules/agent/line-product-facts-profile';

// @req FR-291 — natural fact access requires operator-pinned product IDs and live database scope.
// @tested tests/unit/line-product-facts-profile.test.js
const tenantId='11111111-1111-4111-8111-111111111111';
const businessId='22222222-2222-4222-8222-222222222222';
const accountId='33333333-3333-4333-8333-333333333333';
const product={productId:'44444444-4444-4444-8444-444444444444',sku:'TEST-ONLY-SKU-1'};
const config=()=>({
  ZURI_LINE_NATURAL_PRODUCT_FACTS_ENABLED:'true',
  ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:JSON.stringify([product]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED:'true',
  ZURI_PHASE1_RUNTIME_SOURCE:'MAIN_DEV_LOCAL_OLLAMA',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE:'test_natural',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL:'http://host.docker.internal:11434',
  ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_PATH:path.resolve('test-fixture.json'),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_TEST_FIXTURE_SHA256:'a'.repeat(64),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS:JSON.stringify([tenantId]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS:JSON.stringify([businessId]),
  ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS:JSON.stringify([accountId]),
});
const job={tenantId,businessId,accountId};

describe('natural product facts trusted profile',()=>{
  it('accepts only the configured actual database and three trusted IDs',async()=>{
    const db={$queryRaw:vi.fn().mockResolvedValue([{databaseName:'test_natural'}])};
    expect(await naturalProductFactsScope({env:config(),db,job})).toEqual([product]);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
  });
  it.each([
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_ENABLED:'false'},
    {ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED:'false'},
    {ZURI_PHASE1_RUNTIME_SOURCE:'PRODUCTION_LINE'},
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:'[]'},
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:JSON.stringify([product,product])},
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:JSON.stringify([{...product,sku:'REAL-1'}])},
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:JSON.stringify([{...product,scope:'other'}])},
    {ZURI_LINE_NATURAL_PRODUCT_FACTS_PRODUCTS:JSON.stringify([{...product,productId:'caller-label'}])},
  ])('refuses invalid or disabled config before any database read: %o',async amendment=>{
    const db={$queryRaw:vi.fn()};
    await expect(naturalProductFactsScope({env:{...config(),...amendment},db,job})).rejects.toThrow();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it.each(['tenantId','businessId','accountId'])('rejects foreign %s before any database read',async key=>{
    const db={$queryRaw:vi.fn()};
    await expect(naturalProductFactsScope({env:config(),db,job:{...job,[key]:'55555555-5555-4555-8555-555555555555'}})).rejects.toThrow();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('fails closed for wrong or unavailable database identity',async()=>{
    await expect(naturalProductFactsScope({env:config(),db:{$queryRaw:vi.fn().mockResolvedValue([{databaseName:'production'}])},job})).rejects.toThrow();
    await expect(naturalProductFactsScope({env:config(),db:{$queryRaw:vi.fn().mockRejectedValue(new Error('offline'))},job})).rejects.toThrow();
  });
});
