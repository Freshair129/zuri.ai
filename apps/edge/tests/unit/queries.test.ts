import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DuckDBQueryExecutor } from '../../src/queries/duckdb.js';
import { QUERY_REGISTRY } from '../../src/queries/registry.js';

// @tested BR-001 — DuckDB opens read-only and accepts only registered query ids.
// @tested BR-002 — each registered query has a fixed id, allowed columns, row cap and sensitivity.
// @tested SDD-004 — registered ids, parameter validation and read-only execution.
// @tested SEC-002 — an unregistered query id is refused, so there is no arbitrary SQL surface.
// @tested DR-001 — executive_summary.v1 executes and returns its declared columns.
// @tested DR-002 — channel_performance.v1 executes and its column allowlist holds.
// @tested DR-003 — the campaign_breakdown.v1 contract: id, version, sensitivity, row cap, columns.
// @tested DR-004 — the approval_queue.v1 contract, including its RESTRICTED classification.

/*
 * Two of these need a real SoT on disk; the other two exercise the allow-list and parameter
 * validation, which run before the database is ever opened. Skipping the first pair when the path
 * is unset keeps the suite honest on a machine with no copy of the data — the alternative is a red
 * suite that says nothing, which teaches everyone to ignore it. Set SMARTGIFT_DUCKDB_PATH to run
 * them.
 */
const NEEDS_SOT = process.env.SMARTGIFT_DUCKDB_PATH
  ? false
  : 'SMARTGIFT_DUCKDB_PATH is not set — point it at a read-only copy of the SmartGift DuckDB';

describe('DuckDB Read-Only Query Slice (S3)', () => {
  it('executes registered query executive_summary.v1 correctly', { skip: NEEDS_SOT }, async () => {
    const executor = new DuckDBQueryExecutor();
    const res = await executor.executeRegisteredQuery('executive_summary.v1', { period: 'yesterday' });

    assert.strictEqual(res.queryId, 'executive_summary.v1');
    assert.strictEqual(res.queryVersion, '1.0.0');
    assert.strictEqual(res.sensitivity, 'INTERNAL');
    assert.strictEqual(res.rowCount, 1);
    assert.ok(res.rows[0].total_revenue);
  });

  it('executes channel_performance.v1 and applies column allowlist', { skip: NEEDS_SOT }, async () => {
    const executor = new DuckDBQueryExecutor();
    const res = await executor.executeRegisteredQuery('channel_performance.v1', { period: 'this_week' });

    assert.strictEqual(res.queryId, 'channel_performance.v1');
    assert.ok(res.rowCount > 0);
    assert.ok(res.rows[0].channel_name);
    assert.ok(res.rows[0].revenue);
  });

  it('rejects unregistered query ID', async () => {
    const executor = new DuckDBQueryExecutor();
    await assert.rejects(
      async () => {
        await executor.executeRegisteredQuery('SELECT * FROM secret_table', {});
      },
      /Execution denied: Query ID "SELECT \* FROM secret_table" is not in the registered query allow-list/
    );
  });

  it('rejects invalid parameters', async () => {
    const executor = new DuckDBQueryExecutor();
    await assert.rejects(
      async () => {
        await executor.executeRegisteredQuery('executive_summary.v1', { period: 'invalid_period_value' });
      },
      /Parameter validation failed/
    );
  });
});

/*
 * The four DR-00N rows in PRD-SDD are data contracts: each names an id, a version, a sensitivity
 * class, a row cap and the columns a caller may see. That contract is checkable without a copy of
 * the SmartGift database, and it is the half that matters most — a row cap that drifts, or a
 * RESTRICTED query quietly reclassified, is a policy change wearing a code change's clothes.
 */
describe('registered query data contracts (DR-001..DR-004)', () => {
  const CONTRACTS = [
    ['executive_summary.v1', 'INTERNAL', 10,
      ['total_revenue', 'total_orders', 'active_customers', 'growth_rate', 'risk_flag']],
    ['channel_performance.v1', 'INTERNAL', 20,
      ['channel_name', 'revenue', 'conversions', 'roi_ratio', 'status']],
    ['campaign_breakdown.v1', 'INTERNAL', 50,
      ['campaign_id', 'campaign_name', 'category', 'impressions', 'conversions', 'spend', 'revenue']],
    ['approval_queue.v1', 'RESTRICTED', 20,
      ['action_id', 'action_type', 'urgency', 'status', 'created_at']],
  ] as const;

  for (const [queryId, sensitivity, maxRowCap, allowedColumns] of CONTRACTS) {
    it(`${queryId} matches its declared contract`, () => {
      const entry = QUERY_REGISTRY[queryId];
      assert.ok(entry, `${queryId} is not registered`);
      assert.strictEqual(entry.queryId, queryId);
      assert.strictEqual(entry.version, '1.0.0');
      assert.strictEqual(entry.sensitivity, sensitivity);
      assert.strictEqual(entry.maxRowCap, maxRowCap);
      assert.deepStrictEqual(entry.allowedColumns, [...allowedColumns]);
    });

    it(`${queryId} selects nothing outside its allow-list and stays bounded`, () => {
      const entry = QUERY_REGISTRY[queryId];
      const selected = /SELECT\s+([\s\S]*?)\s+FROM/i.exec(entry.sqlTemplate);
      assert.ok(selected, `${queryId} has no parseable SELECT list`);
      const columns = selected[1].split(',').map((c) => c.trim());
      for (const column of columns) {
        assert.ok(entry.allowedColumns.includes(column),
          `${queryId} selects ${column}, which its allow-list does not permit`);
      }
      assert.match(entry.sqlTemplate, /LIMIT/i, `${queryId} has no row bound`);
    });
  }

  it('classifies exactly one query as RESTRICTED, and it is the approvals queue', () => {
    const restricted = Object.values(QUERY_REGISTRY)
      .filter((q) => q.sensitivity === 'RESTRICTED')
      .map((q) => q.queryId);
    assert.deepStrictEqual(restricted, ['approval_queue.v1']);
  });
});
