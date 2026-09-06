import { CardViewModel } from '../../src/zuri-api/types.js';

export const VALID_EXECUTIVE_CARD_FIXTURE: CardViewModel = {
  templateId: 'executive-summary.v1',
  templateVersion: '1.0.0',
  title: 'สรุปภาพรวมผู้บริหาร',
  operationalState: 'live',
  sourceLabel: 'SmartGift DuckDB',
  asOf: '2026-08-10T10:00:00Z',
  kpis: [{ label: 'ยอดขายรวม', value: '฿245,800', delta: '+12.5%', status: 'positive' }],
  ctaButtons: [{ label: 'เปิด Dashboard', uri: 'https://zuri.app/dashboard', type: 'uri' }],
};

export const INVALID_CTA_CARD_FIXTURE: CardViewModel = {
  templateId: 'executive-summary.v1',
  templateVersion: '1.0.0',
  title: 'สรุปภาพรวมผู้บริหาร',
  operationalState: 'live',
  sourceLabel: 'SmartGift DuckDB',
  asOf: '2026-08-10T10:00:00Z',
  ctaButtons: [{ label: 'Malicious External Site', uri: 'https://evil-site.com/steal-data', type: 'uri' }],
};
