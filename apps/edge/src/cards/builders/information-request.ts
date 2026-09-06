import { CardViewModel } from '../../zuri-api/types.js';
import { CardBuilderContext } from '../types.js';

/** Bounded non-PII checklist; it reports a data gap, never a fabricated forecast. */
export function buildInformationRequestCard(
  rows: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  const asOf = ctx?.asOf || new Date().toISOString();
  const suppliedItems = rows.length > 0
    ? rows
    : [
      { title: 'ยอดขายย้อนหลัง 1 ไตรมาส', subtitle: 'ยอดขายรายวัน / ช่องทาง / หมวดสินค้า', status: 'MISSING' },
      { title: 'เป้ายอดขายและสมมติฐาน Forecast', subtitle: 'เป้ารายเดือน, seasonality, กิจกรรมสำคัญ', status: 'MISSING' },
      { title: 'Sales pipeline ที่เปิดอยู่', subtitle: 'มูลค่า, stage, โอกาสปิด และกำหนดส่งมอบ', status: 'MISSING' },
      { title: 'งบและแผนแคมเปญ', subtitle: 'LINE / Facebook / Ads พร้อมช่วงเวลา', status: 'MISSING' },
    ];

  return {
    templateId: 'information-request.v1',
    templateVersion: '1.0.0',
    title: ctx?.title || 'Checklist ข้อมูลสำหรับ Forecast ยอดขาย 1Q',
    subtitle: ctx?.subtitle || 'ซูริสรุปรายการที่ต้องเติมก่อนเริ่มคาดการณ์อย่างมีหลักฐาน',
    operationalState: ctx?.operationalState || 'snapshot',
    sourceLabel: ctx?.sourceLabel || 'SmartGift DuckDB schema audit',
    asOf,
    items: suppliedItems.slice(0, 5).map((row) => ({
      title: String(row.title || 'รายการข้อมูล'),
      subtitle: String(row.subtitle || 'รายละเอียดที่ต้องเตรียม'),
      value: row.status === 'READY' ? 'พร้อมใช้' : 'ยังต้องเติม',
      badge: String(row.status || 'MISSING'),
    })),
    riskFlags: ctx?.riskFlags && ctx.riskFlags.length > 0
      ? ctx.riskFlags
      : ['ยังไม่ใช่ Forecast จริงจนกว่าข้อมูลที่จำเป็นจะครบและผ่านการตรวจแหล่งที่มา'],
    ctaButtons: ctx?.ctaButtons && ctx.ctaButtons.length > 0
      ? ctx.ctaButtons
      : [{ label: 'เปิด Dashboard', uri: 'https://zuri.app/dashboard', type: 'uri' }],
  };
}
