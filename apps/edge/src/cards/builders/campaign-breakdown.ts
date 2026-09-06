import { CardViewModel } from '../../zuri-api/types.js';
import { CardBuilderContext } from '../types.js';

export function buildCampaignBreakdownCard(
  rows: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  const state = ctx?.operationalState || 'live';
  const asOf = ctx?.asOf || new Date().toISOString();
  const sourceLabel = ctx?.sourceLabel || 'SmartGift DuckDB';

  const items = rows.map((r) => ({
    title: (r.campaign_name as string) || 'แคมเปญไม่ระบุชื่อ',
    value: (r.revenue as string) || '฿0',
    subtitle: `หมวดหมู่: ${r.category || '-'} | ค่าใช้จ่าย: ${r.spend || '฿0'}`,
    badge: `Conversions: ${r.conversions || 0}`,
  }));

  return {
    templateId: 'campaign-breakdown.v1',
    templateVersion: '1.0.0',
    title: 'สรุปรายแคมเปญและหมวดหมู่',
    subtitle: 'อันดับแคมเปญที่สร้างรายได้สูงสุด',
    operationalState: state,
    sourceLabel,
    asOf,
    items,
    ctaButtons: [
      {
        label: 'ดูรายละเอียดแคมเปญ',
        uri: 'https://zuri.app/campaigns',
        type: 'uri',
      },
    ],
  };
}
