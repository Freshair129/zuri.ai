import { CardViewModel } from '../../zuri-api/types.js';
import { CardBuilderContext } from '../types.js';

export function buildChannelPerformanceCard(
  rows: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  const state = ctx?.operationalState || 'live';
  const asOf = ctx?.asOf || new Date().toISOString();
  const sourceLabel = ctx?.sourceLabel || 'SmartGift DuckDB';

  const items = rows.map((r) => ({
    title: (r.channel_name as string) || 'ไม่ระบุช่องทาง',
    value: (r.revenue as string) || '฿0',
    subtitle: `แปลงเป็นยอดขาย: ${r.conversions || 0} รายการ | ROI: ${r.roi_ratio || 'N/A'}`,
    badge: (r.status as string) || 'live',
  }));

  return {
    templateId: 'channel-performance.v1',
    templateVersion: '1.0.0',
    title: 'ประสิทธิภาพแยกตามช่องทาง',
    subtitle: 'เปรียบเทียบยอดขาย LINE, Facebook และ Ads',
    operationalState: state,
    sourceLabel,
    asOf,
    items,
    ctaButtons: [
      {
        label: 'ดูรายละเอียดช่องทาง',
        uri: 'https://zuri.app/channels',
        type: 'uri',
      },
    ],
  };
}
