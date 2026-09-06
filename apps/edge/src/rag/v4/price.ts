import type { PriceTier, SelectedPrice } from './search.js';

export function selectTier(ladder: PriceTier[], qty: number | null): SelectedPrice | null {
  const priced = ladder.filter((t) => !t.priceMissing && t.qtyTier !== null).sort((a, b) => a.qtyTier! - b.qtyTier!);
  if (!priced.length) return null;
  if (qty === null) return { qtyTier: priced[0].qtyTier, unitPrice: priced[0].unitPrice, belowMoq: false, source: 'offer' };
  const le = priced.filter((t) => t.qtyTier! <= qty);
  if (!le.length) return { qtyTier: priced[0].qtyTier, unitPrice: priced[0].unitPrice, belowMoq: true, source: 'offer' };
  const best = le[le.length - 1];
  return { qtyTier: best.qtyTier, unitPrice: best.unitPrice, belowMoq: false, source: 'offer' };
}

export function ladderFromCsku(nodes: Array<{ props: any }>, offerCode: string | null = null): PriceTier[] {
  return nodes.map((n) => ({ qtyTier: n.props.qtyTier ?? null, unitPrice: Number(n.props.unitPrice) || 0, commercialSku: n.props.flowAccountCode ?? null, priceMissing: Boolean(n.props.priceMissing), exportDate: (n.props.exportDate as string | undefined) ?? null, offerCode: offerCode ?? (n.props.offerCode as string | undefined) ?? null }))
    .sort((a, b) => (a.qtyTier ?? 1e9) - (b.qtyTier ?? 1e9));
}
