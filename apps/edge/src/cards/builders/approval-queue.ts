import { CardViewModel } from '../../zuri-api/types.js';
import { CardBuilderContext } from '../types.js';

export function buildApprovalQueueCard(
  rows: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  const state = ctx?.operationalState || 'live';
  const asOf = ctx?.asOf || new Date().toISOString();
  const sourceLabel = ctx?.sourceLabel || 'SmartGift DuckDB';

  const items = rows.map((r) => ({
    title: (r.action_type as string) || 'รายการรอนุมัติ',
    value: `ความเร่งด่วน: ${r.urgency || 'MEDIUM'}`,
    subtitle: `รหัสอ้างอิง: ${r.action_id || '-'}`,
    badge: (r.status as string) || 'PENDING',
  }));

  return {
    templateId: 'actions-approval-queue.v1',
    templateVersion: '1.0.0',
    title: 'รายการรออนุมัติและการดำเนินการ',
    subtitle: `มี ${rows.length} รายการที่รอการตรวจสอบ`,
    operationalState: state,
    sourceLabel,
    asOf,
    items,
    ctaButtons: [
      {
        label: 'เปิดรายการอนุมัติ',
        uri: 'https://zuri.app/approvals',
        type: 'uri',
      },
    ],
  };
}
