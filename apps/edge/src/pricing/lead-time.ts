import { FreightMode, Provenance } from './types.js';

/**
 * How long an order takes from deposit to delivery, and therefore which freight mode a customer's
 * deadline actually allows. Confirmed by the owner 2026-08-11.
 *
 * The stages are the company's own workflow:
 *
 *   1. Order placed, 50% deposit, logo supplied
 *   2. Artwork sent to the customer            — 2 working days
 *   3. Customer confirms artwork               — the customer's own time, not counted here
 *   4. Sample made, photographed and filmed    — 3–5 working days
 *   5. Customer confirms the sample            — again the customer's own time
 *   6. Production                              — 7 days to 500 sets, 15 days to 1,000
 *   7. Freight                                 — truck 7–10 days, sea 21–30 days
 *
 * A rush order skips stages 4 and 5 outright: once the artwork is confirmed the factory starts,
 * with no sample photos. That is what makes 15–20 days achievable by road.
 *
 * Everything below is company time. The elapsed date a customer experiences also includes their
 * own turnaround at stages 3 and 5, which is the single largest source of slippage and is stated
 * separately rather than folded in.
 */
export const LEAD_TIME_PROVENANCE: Provenance = {
  source: 'SmartGift order workflow, confirmed by the owner',
  asOf: '2026-08-11',
  note: 'Company working days only. Customer confirmation time at artwork and sample stages is excluded.',
};

export interface LeadTimeStage {
  key: 'artwork' | 'sample' | 'production' | 'freight';
  label: string;
  minDays: number;
  maxDays: number;
}

export interface LeadTime {
  mode: FreightMode;
  rush: boolean;
  stages: LeadTimeStage[];
  minDays: number;
  maxDays: number;
}

const ARTWORK: LeadTimeStage = { key: 'artwork', label: 'ส่งอาร์ตเวิร์คให้ลูกค้าคอนเฟิร์ม', minDays: 2, maxDays: 2 };
const SAMPLE: LeadTimeStage = { key: 'sample', label: 'ทำตัวอย่าง ถ่ายภาพและคลิป', minDays: 3, maxDays: 5 };

const FREIGHT_DAYS: Record<FreightMode, [number, number]> = {
  truck: [7, 10],
  sea: [21, 30],
};

/** Production runs longer past 500 sets. */
export function productionDays(quantity: number): [number, number] {
  return quantity <= 500 ? [7, 7] : [15, 15];
}

export function leadTimeFor(quantity: number, mode: FreightMode, rush = false): LeadTime {
  const [prodMin, prodMax] = productionDays(quantity);
  const [freightMin, freightMax] = FREIGHT_DAYS[mode];

  const stages: LeadTimeStage[] = [
    ARTWORK,
    ...(rush ? [] : [SAMPLE]),
    { key: 'production', label: 'ผลิต', minDays: prodMin, maxDays: prodMax },
    {
      key: 'freight',
      label: mode === 'truck' ? 'ขนส่งทางรถ' : 'ขนส่งทางเรือ',
      minDays: freightMin,
      maxDays: freightMax,
    },
  ];

  return {
    mode,
    rush,
    stages,
    minDays: stages.reduce((n, s) => n + s.minDays, 0),
    maxDays: stages.reduce((n, s) => n + s.maxDays, 0),
  };
}

/**
 * The cheapest mode that still lands inside the customer's deadline.
 *
 * Sea is always cheaper and always slower, so the choice is a real trade the salesperson makes on
 * the customer's behalf — which is why the answer carries the reason and the days it needs, not
 * just a mode. Judged on the worst case: promising on the optimistic end of a range is how a
 * delivery date gets missed.
 */
export function modeForDeadline(
  quantity: number,
  deadlineDays: number,
  rush = false
): { mode: FreightMode | null; leadTime: LeadTime; reason: string } {
  const sea = leadTimeFor(quantity, 'sea', rush);
  if (deadlineDays >= sea.maxDays) {
    return {
      mode: 'sea',
      leadTime: sea,
      reason: `${deadlineDays} วันพอสำหรับทางเรือ (ใช้ ${sea.minDays}-${sea.maxDays} วัน) ซึ่งค่าขนส่งถูกกว่า`,
    };
  }

  const truck = leadTimeFor(quantity, 'truck', rush);
  if (deadlineDays >= truck.maxDays) {
    return {
      mode: 'truck',
      leadTime: truck,
      reason: `${deadlineDays} วันไม่พอสำหรับทางเรือ (ต้องการ ${sea.maxDays} วัน) จึงต้องส่งทางรถ`,
    };
  }

  if (!rush) {
    const rushTruck = leadTimeFor(quantity, 'truck', true);
    if (deadlineDays >= rushTruck.maxDays) {
      return {
        mode: 'truck',
        leadTime: rushTruck,
        reason:
          `${deadlineDays} วันทำได้เฉพาะแบบงานเร่ง — ข้ามขั้นทำตัวอย่าง ` +
          `เริ่มผลิตทันทีที่ลูกค้าคอนเฟิร์มอาร์ตเวิร์ค (${rushTruck.minDays}-${rushTruck.maxDays} วัน)`,
      };
    }
  }

  const fastest = leadTimeFor(quantity, 'truck', true);
  return {
    mode: null,
    leadTime: fastest,
    reason:
      `${deadlineDays} วันไม่พอแม้แบบงานเร่งทางรถ ซึ่งใช้ ${fastest.minDays}-${fastest.maxDays} วัน ` +
      `— ต้องขยับกำหนดส่งหรือลดจำนวน`,
  };
}
