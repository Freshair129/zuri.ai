import { getRegisteredQuery } from './registry.js';
import { SensitivityClass } from '../zuri-api/types.js';
import { logDiagnostic } from '../safety/redact.js';

// @req BR-001 — DuckDB is opened read-only and accepts only registered query ids; raw SQL from an
//   operator, a model or LINE is rejected.

export interface QueryExecutionResult {
  queryId: string;
  queryVersion: string;
  sensitivity: SensitivityClass;
  source: string;
  asOf: string;
  rows: Record<string, unknown>[];
  rowCount: number;
}

export class DuckDBQueryExecutor {
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || ':memory:';
  }

  /**
   * Execute a registered query ID safely.
   * REJECTS raw SQL queries or unregistered query IDs.
   */
  async executeRegisteredQuery(
    queryId: string,
    parameters: Record<string, unknown>
  ): Promise<QueryExecutionResult> {
    const query = getRegisteredQuery(queryId);
    if (!query) {
      throw new Error(`Execution denied: Query ID "${queryId}" is not in the registered query allow-list.`);
    }

    const validation = query.validateParameters(parameters);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed for ${queryId}: ${validation.error}`);
    }

    logDiagnostic(`Executing read-only registered query: ${queryId}`);

    const rows = await this.fetchQueryData(queryId, parameters, query.maxRowCap, query.allowedColumns);

    // Enforce row cap safety constraint
    const cappedRows = rows.slice(0, query.maxRowCap);

    // Filter allowed columns only
    const filteredRows = cappedRows.map((row) => {
      const cleanRow: Record<string, unknown> = {};
      for (const col of query.allowedColumns) {
        if (col in row) {
          cleanRow[col] = row[col];
        }
      }
      return cleanRow;
    });

    return {
      queryId: query.queryId,
      queryVersion: query.version,
      sensitivity: query.sensitivity,
      source: 'SmartGift DuckDB Analytics',
      asOf: new Date().toISOString(),
      rows: filteredRows,
      rowCount: filteredRows.length,
    };
  }

  /**
   * Mock/fixture data provider for read-only DuckDB execution
   */
  private async fetchQueryData(
    queryId: string,
    params: Record<string, unknown>,
    _maxRowCap: number,
    _allowedColumns: string[]
  ): Promise<Record<string, unknown>[]> {
    const period = (params.period as string) || 'yesterday';

    switch (queryId) {
      case 'executive_summary.v1':
        return [
          {
            total_revenue: '฿245,800',
            total_orders: 1240,
            active_customers: 890,
            growth_rate: '+12.5%',
            risk_flag: 'none',
            period,
          },
        ];

      case 'channel_performance.v1':
        return [
          { channel_name: 'LINE Official Account', revenue: '฿125,000', conversions: 650, roi_ratio: '4.2x', status: 'live' },
          { channel_name: 'Facebook Shop', revenue: '฿80,800', conversions: 410, roi_ratio: '3.1x', status: 'live' },
          { channel_name: 'Google Ads', revenue: '฿40,000', conversions: 180, roi_ratio: '2.5x', status: 'snapshot' },
        ];

      case 'campaign_breakdown.v1':
        return [
          { campaign_id: 'cmp_01', campaign_name: 'Mother Day Promo', category: 'Gift Box', impressions: 45000, conversions: 320, spend: '฿15,000', revenue: '฿95,000' },
          { campaign_id: 'cmp_02', campaign_name: 'New User Coupon', category: 'Vouchers', impressions: 28000, conversions: 210, spend: '฿8,000', revenue: '฿42,000' },
          { campaign_id: 'cmp_03', campaign_name: 'VIP Rewards', category: 'Premium Gifts', impressions: 12000, conversions: 95, spend: '฿5,000', revenue: '฿38,000' },
        ];

      case 'approval_queue.v1':
        return [
          { action_id: 'act_101', action_type: 'Discount Campaign Promotion', urgency: 'HIGH', status: 'PENDING', created_at: new Date().toISOString() },
          { action_id: 'act_102', action_type: 'Budget Adjustment Request', urgency: 'MEDIUM', status: 'PENDING', created_at: new Date().toISOString() },
          { action_id: 'act_103', action_type: 'New Product Category Listing', urgency: 'LOW', status: 'PENDING', created_at: new Date().toISOString() },
        ];

      default:
        return [];
    }
  }
}
