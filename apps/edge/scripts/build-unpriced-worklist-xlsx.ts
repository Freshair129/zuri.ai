/** Build the sales worklist Excel from the unpriced-offer worklist + price-PDF index.
 *
 * Usage: node --import tsx scripts/build-unpriced-worklist-xlsx.ts [out.xlsx]
 *
 * One row per unpriced base: where its price already exists in the ใบราคา PDFs plus blank
 * price-tier columns for keying into FlowAccount. Companion to RCA-PRICE-DATA-LOSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { readFlowAccountXlsx, parseFlowAccountRows, buildUnpricedWorklist, type PricePdfRef } from '../src/rag/v4/flowaccount.js';
import { resolvePipelinePaths } from '../src/rag/v4/paths.js';

const dataRoot = resolvePipelinePaths().dataRoot;
const outPath = process.argv[2] ?? path.join(dataRoot, 'review', `unpriced-offers-worklist.xlsx`);
const TIERS = [10, 20, 50, 100, 300, 500];

const rows = await readFlowAccountXlsx(path.join(dataRoot, 'source', 'flowaccount-product-2026-06-21.xlsx'));
const parsed = parseFlowAccountRows(rows);
const indexPath = path.join(dataRoot, 'source', 'price-pdf-index.json');
const pdfIndex: Record<string, PricePdfRef[]> = fs.existsSync(indexPath)
  ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  : {};
const worklist = buildUnpricedWorklist(parsed.lines, pdfIndex);

// found-in-PDF first (sales can key those immediately), then the truly absent ones
const sorted = [...worklist].sort((a, b) =>
  (b.priceListRefs.length > 0 ? 1 : 0) - (a.priceListRefs.length > 0 ? 1 : 0) || a.base.localeCompare(b.base));

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('คีย์ราคาเข้า FlowAccount');
ws.columns = [
  { header: 'รหัสชุด', key: 'base', width: 12 },
  { header: 'ชื่อสินค้า (FlowAccount)', key: 'name', width: 55 },
  { header: 'สถานะ', key: 'status', width: 22 },
  { header: 'พบราคาในไฟล์', key: 'files', width: 60 },
  { header: 'หน้า', key: 'pages', width: 14 },
  ...TIERS.map((t) => ({ header: `ราคา @${t}`, key: `t${t}`, width: 10 })),
  { header: 'หมายเหตุ', key: 'note', width: 30 },
];
ws.getRow(1).font = { bold: true };
ws.views = [{ state: 'frozen', ySplit: 1 }];

for (const e of sorted) {
  const found = e.priceListRefs.length > 0;
  const row = ws.addRow({
    base: e.base,
    name: e.name,
    status: found ? 'พบราคาในใบราคา — คีย์ได้เลย' : 'ไม่พบราคาในเอกสารใด',
    files: e.priceListRefs.map((r) => r.file).join('\n'),
    pages: e.priceListRefs.map((r) => r.pages.join(',')).join('\n'),
    note: found ? '' : 'ตัดสินใจ: ตั้งราคาใหม่ หรือ mark ไม่ใช้งาน',
  });
  row.getCell('files').alignment = { wrapText: true, vertical: 'top' };
  row.getCell('name').alignment = { wrapText: true, vertical: 'top' };
  if (!found) {
    row.getCell('status').font = { color: { argb: 'FF9C0006' } };
  }
}

const found = sorted.filter((e) => e.priceListRefs.length > 0).length;
const sum = wb.addWorksheet('สรุป');
sum.columns = [{ width: 55 }, { width: 12 }];
sum.addRows([
  ['ชุดสินค้าใน FlowAccount ที่ไม่มีราคาเลย (UnitPrice = 0 ทุกแถว)', sorted.length],
  ['— พบราคาอยู่แล้วในใบราคา PDF (คีย์เข้า FlowAccount ได้เลย)', found],
  ['— ไม่พบราคาในเอกสารใด (ต้องตั้งราคาใหม่ หรือ mark ไม่ใช้งาน)', sorted.length - found],
  [],
  ['ที่มา: RCA-PRICE-DATA-LOSS (.brain/rca/2026-08-24-rca-price-data-loss.md)'],
  ['เมื่อคีย์ราคาครบและ export ใหม่ ระบบจะเห็นราคาโดยไม่ต้องแก้โค้ด'],
]);
sum.getRow(1).font = { bold: true };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
await wb.xlsx.writeFile(outPath);
console.log(`[worklist-xlsx] ${sorted.length} bases (${found} with PDF refs) -> ${outPath}`);
