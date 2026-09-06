import { RegisteredQuery } from './types.js';

// @req BR-002 — each registered query carries a fixed id and version, an allowed-column list, a row
//   cap and a sensitivity class, and validates its parameters.
// @req SDD-004 — the query registry: registry ids, parameter schemas and read-only DuckDB execution.
// @req SEC-002 — the query registry is the only SQL surface: no arbitrary SQL, shell or filesystem execution reaches the store.
// @req DR-001 — the executive_summary.v1 data contract.
// @req DR-002 — the channel_performance.v1 data contract.
// @req DR-003 — the campaign_breakdown.v1 data contract.
// @req DR-004 — the approval_queue.v1 data contract, the one classified RESTRICTED.

export const QUERY_REGISTRY: Record<string, RegisteredQuery> = {
  'executive_summary.v1': {
    queryId: 'executive_summary.v1',
    version: '1.0.0',
    description: 'SmartGift executive aggregate metrics and status',
    sensitivity: 'INTERNAL',
    allowedColumns: ['total_revenue', 'total_orders', 'active_customers', 'growth_rate', 'risk_flag'],
    maxRowCap: 10,
    sqlTemplate: `
      SELECT total_revenue, total_orders, active_customers, growth_rate, risk_flag
      FROM executive_daily_summary
      WHERE period = ?
      LIMIT 1
    `,
    validateParameters: (params) => {
      const validPeriods = ['today', 'yesterday', 'this_week', 'this_month'];
      const period = (params.period as string) || 'yesterday';
      if (!validPeriods.includes(period)) {
        return { valid: false, error: `Invalid period parameter: ${period}` };
      }
      return { valid: true };
    },
  },

  'channel_performance.v1': {
    queryId: 'channel_performance.v1',
    version: '1.0.0',
    description: 'Channel sales and engagement breakdown across LINE, FB, Ads',
    sensitivity: 'INTERNAL',
    allowedColumns: ['channel_name', 'revenue', 'conversions', 'roi_ratio', 'status'],
    maxRowCap: 20,
    sqlTemplate: `
      SELECT channel_name, revenue, conversions, roi_ratio, status
      FROM channel_performance_summary
      WHERE period = ?
      ORDER BY revenue DESC
      LIMIT ?
    `,
    validateParameters: (params) => {
      const validPeriods = ['today', 'yesterday', 'this_week', 'this_month'];
      const period = (params.period as string) || 'yesterday';
      if (!validPeriods.includes(period)) {
        return { valid: false, error: `Invalid period parameter: ${period}` };
      }
      return { valid: true };
    },
  },

  'campaign_breakdown.v1': {
    queryId: 'campaign_breakdown.v1',
    version: '1.0.0',
    description: 'Category and campaign performance breakdown',
    sensitivity: 'INTERNAL',
    allowedColumns: ['campaign_id', 'campaign_name', 'category', 'impressions', 'conversions', 'spend', 'revenue'],
    maxRowCap: 50,
    sqlTemplate: `
      SELECT campaign_id, campaign_name, category, impressions, conversions, spend, revenue
      FROM campaign_performance_summary
      WHERE period = ?
      ORDER BY revenue DESC
      LIMIT ?
    `,
    validateParameters: (params) => {
      const validPeriods = ['today', 'yesterday', 'this_week', 'this_month'];
      const period = (params.period as string) || 'yesterday';
      if (!validPeriods.includes(period)) {
        return { valid: false, error: `Invalid period parameter: ${period}` };
      }
      return { valid: true };
    },
  },

  'approval_queue.v1': {
    queryId: 'approval_queue.v1',
    version: '1.0.0',
    description: 'Actions and approvals queue without customer PII',
    sensitivity: 'RESTRICTED',
    allowedColumns: ['action_id', 'action_type', 'urgency', 'status', 'created_at'],
    maxRowCap: 20,
    sqlTemplate: `
      SELECT action_id, action_type, urgency, status, created_at
      FROM actions_approval_queue
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ?
    `,
    validateParameters: (params) => {
      if (params.limit !== undefined && (typeof params.limit !== 'number' || params.limit < 1)) {
        return { valid: false, error: 'Limit parameter must be a positive integer' };
      }
      return { valid: true };
    },
  },
};

export function getRegisteredQuery(queryId: string): RegisteredQuery | null {
  return QUERY_REGISTRY[queryId] || null;
}
