export const DUCKDB_MOCK_FIXTURES = {
  executive_summary: {
    total_revenue: '฿245,800',
    total_orders: 1240,
    active_customers: 890,
    growth_rate: '+12.5%',
    risk_flag: 'none',
  },
  channel_performance: [
    { channel_name: 'LINE Official Account', revenue: '฿125,000', conversions: 650, roi_ratio: '4.2x', status: 'live' },
    { channel_name: 'Facebook Shop', revenue: '฿80,800', conversions: 410, roi_ratio: '3.1x', status: 'live' },
    { channel_name: 'Google Ads', revenue: '฿40,000', conversions: 180, roi_ratio: '2.5x', status: 'snapshot' },
  ],
  campaign_breakdown: [
    { campaign_id: 'cmp_01', campaign_name: 'Mother Day Promo', category: 'Gift Box', impressions: 45000, conversions: 320, spend: '฿15,000', revenue: '฿95,000' },
  ],
  approval_queue: [
    { action_id: 'act_101', action_type: 'Discount Campaign Promotion', urgency: 'HIGH', status: 'PENDING', created_at: '2026-08-10T10:00:00Z' },
  ],
};
