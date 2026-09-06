import {
  FreightMode,
  FreightRate,
  FreightSelection,
  GoodsClass,
  MembershipTier,
  Provenance,
  Warehouse,
} from './types.js';

/**
 * SmartGift's account with LK: Guangzhou warehouse, SILVER tier. Confirmed by the owner
 * 2026-08-11, along with the note that the goods are light — so freight is volume-charged in
 * practice.
 */
export const SMARTGIFT_FREIGHT_ACCOUNT = {
  warehouse: 'guangzhou_shenzhen' as const,
  membershipTier: 'silver' as const,
};

/**
 * Density threshold printed on the LK sheet: below it the shipment is charged on volume, at or
 * above it on weight.
 *
 *   สินค้าที่มีน้ำหนักเฉลี่ยน้อยกว่า 400 กิโลกรัม/คิวบิกเมตร : คิดตามขนาด (บาท/คิวบิกเมตร)
 *   สินค้าที่มีน้ำหนักเฉลี่ยมากกว่า 400 กิโลกรัม/คิวบิกเมตร : คิดตามน้ำหนัก (บาท/กิโลกรัม)
 */
export const DENSITY_SWITCH_KG_PER_CBM = 400;

/** Minimum billable volume per package, also from the sheet: "คิดราคาเริ่มต้นที่ 0.01 คิวบิกเมตร/แพคเกจ". */
export const MIN_BILLABLE_CBM_PER_PACKAGE = 0.01;

export const FREIGHT_RATE_PROVENANCE: Provenance = {
  source:
    'Google Drive · SmartGift/ค่าขนส่งจีน-ไทย/{LK-กวางโจว.jpg, LK-อี้อู.jpg} (LK shipping rate cards)',
  asOf: '2026-07-27',
  note:
    'Transcribed from photographed rate sheets. Rates are contractual with the freight forwarder ' +
    'and change without notice — re-confirm before quoting a large order.',
};

type RateRow = Record<MembershipTier, FreightRate>;
type RateTable = Record<GoodsClass, RateRow>;

/** `5900/15` on the sheet means 5,900 THB per CBM or 15 THB per kg. */
function row(
  elite: [number, number],
  gold: [number, number],
  silver: [number, number],
  member: [number, number]
): RateRow {
  const cell = ([thbPerCbm, thbPerKg]: [number, number]): FreightRate => ({ thbPerCbm, thbPerKg });
  return { elite: cell(elite), gold: cell(gold), silver: cell(silver), member: cell(member) };
}

const GUANGZHOU_SHENZHEN_TRUCK: RateTable = {
  general: row([5900, 15], [6400, 16], [6900, 18], [7400, 19]),
  electronic_tisi: row([6400, 16], [6900, 18], [7400, 19], [7900, 20]),
  cosmetic_fda: row([7000, 18], [7500, 19], [8000, 20], [8500, 22]),
  other: row([9000, 23], [9500, 24], [10000, 25], [10500, 27]),
};

const GUANGZHOU_SHENZHEN_SEA: RateTable = {
  general: row([3900, 10], [4400, 11], [4900, 13], [5400, 14]),
  electronic_tisi: row([4400, 11], [4900, 13], [5400, 14], [5900, 15]),
  cosmetic_fda: row([5500, 14], [6000, 15], [6500, 17], [7000, 18]),
  other: row([7500, 19], [8000, 20], [8500, 22], [9000, 23]),
};

const YIWU_TRUCK: RateTable = {
  general: row([6400, 16], [6900, 18], [7400, 19], [7900, 20]),
  electronic_tisi: row([6900, 18], [7400, 19], [7900, 20], [8400, 21]),
  cosmetic_fda: row([7500, 19], [8000, 20], [8500, 22], [9000, 23]),
  other: row([9500, 24], [10000, 25], [10500, 27], [11000, 28]),
};

/** The Yiwu sea table matches Guangzhou/Shenzhen cell for cell on the source sheets. */
const YIWU_SEA: RateTable = GUANGZHOU_SHENZHEN_SEA;

const RATE_CARD: Record<Warehouse, Record<FreightMode, RateTable>> = {
  guangzhou_shenzhen: { truck: GUANGZHOU_SHENZHEN_TRUCK, sea: GUANGZHOU_SHENZHEN_SEA },
  yiwu: { truck: YIWU_TRUCK, sea: YIWU_SEA },
};

export function getFreightRate(
  selection: Omit<FreightSelection, 'mode'>,
  mode: FreightMode
): FreightRate {
  return RATE_CARD[selection.warehouse][mode][selection.goodsClass][selection.membershipTier];
}

/**
 * Months of the selling season, when customers are in a hurry. Sep–Jan.
 */
export const SELLING_SEASON_MONTHS = [9, 10, 11, 12, 1];

/** Off-season shipments above this volume go by sea; smaller ones still go by truck. */
export const SEA_THRESHOLD_CBM = 5;

/**
 * SmartGift's own routing rule:
 *
 *   1. In the Sep–Jan selling season everything goes by truck, because customers are rushing.
 *   2. Off season, anything over 5 CBM goes by sea.
 *
 * The volume test means the mode can change between quantity breaks of one quote — which is
 * correct, and why the resolved mode is reported per break rather than once per quote.
 */
export function resolveFreightMode(
  shipMonth: number,
  shipmentCbm: number
): { mode: FreightMode; reason: string } {
  if (SELLING_SEASON_MONTHS.includes(shipMonth)) {
    return { mode: 'truck', reason: `month ${shipMonth} is in the Sep–Jan selling season` };
  }
  if (shipmentCbm > SEA_THRESHOLD_CBM) {
    return {
      mode: 'sea',
      reason: `off season and ${shipmentCbm} CBM exceeds the ${SEA_THRESHOLD_CBM} CBM sea threshold`,
    };
  }
  return {
    mode: 'truck',
    reason: `off season but ${shipmentCbm} CBM is within the ${SEA_THRESHOLD_CBM} CBM sea threshold`,
  };
}

/**
 * Goods class from box contents. Anything with an electrical component in the carton takes the
 * Electronic มอก. rate; a box with none takes the cheaper general rate.
 */
export function resolveGoodsClass(containsElectronics: boolean): GoodsClass {
  return containsElectronics ? 'electronic_tisi' : 'general';
}
