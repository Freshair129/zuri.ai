import { CardViewModel } from '../../zuri-api/types.js';
import { CardBuilderContext } from '../types.js';

export function buildExecutiveSummaryCard(
  rows: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  const row = rows[0] || {};
  const state = ctx?.operationalState || 'live';
  const asOf = ctx?.asOf || new Date().toISOString();
  const sourceLabel = ctx?.sourceLabel || 'SmartGift DuckDB';

  const totalRevenue = (row.total_revenue as string) || '฿0';
  const totalOrders = row.total_orders !== undefined ? String(row.total_orders) : '0';
  const activeCustomers = row.active_customers !== undefined ? String(row.active_customers) : '0';
  const growthRate = (row.growth_rate as string) || '0%';
  const riskFlag = (row.risk_flag as string) || 'none';

  return {
    templateId: 'executive-summary.v1',
    templateVersion: '1.0.0',
    title: 'สรุปภาพรวมผู้บริหาร',
    subtitle: `สถานะข้อมูล ณ ${new Date(asOf).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`,
    operationalState: state,
    sourceLabel,
    asOf,
    kpis: [
      { label: 'ยอดขายรวม', value: totalRevenue, delta: growthRate, status: 'positive' },
      { label: 'คำสั่งซื้อทั้งหมด', value: totalOrders, status: 'neutral' },
      { label: 'ลูกค้าที่มีการเคลื่อนไหว', value: activeCustomers, status: 'neutral' },
    ],
    riskFlags: riskFlag !== 'none' ? [`ข้อควรระวัง: ${riskFlag}`] : [],
    ctaButtons: [
      {
        label: 'เปิด Dashboard',
        uri: 'https://zuri.app/dashboard',
        type: 'uri',
      },
    ],
  };
}
