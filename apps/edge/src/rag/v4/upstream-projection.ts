// Projects the upstream SmartGift `pricelist_master.json` into the two inputs `buildGraphV4`
// consumes: the semantic catalog (`catalog-2026.json`) and the owner-logic identity review.
//
// Why this exists: the documented chain was
//   giftset.json + catalog-2026.json -> catalog-manifest -> catalog-identity -> user-logic-review
// but both of its leaf inputs were machine-local files that no longer exist anywhere, so
// `identity-review.json` had become unregenerable. `pricelist_master.json` is the projection the
// business-01-smart-gift data-pipeline exports from the same `smartgift_*` SQL tables those files
// were themselves derived from, and it is verifiably the same lineage: its 32 `product_families`
// and 4 `source_group_id`s match `src/rag/v4/config/*.json` exactly, and its 427 product masters
// match the count the v4 design doc records for this snapshot.
//
// Known fidelity gap, deliberate and reported rather than papered over: the retired chain split
// each product master into several PhysicalVariants by physical signature (1,128 across 427
// masters). `pricelist_master.json` keeps colours on the master and does not carry that split, so
// this projection emits exactly one PhysicalVariant per master carrying all of its colours.
// Colour attributes, SKU display codes and search all still work; what is lost is variant-level
// *separation* within one master. `variantsPerMaster: 1` in the stats records this so the
// artifact is never mistaken for the richer one.
import { createHash } from 'node:crypto';

import type {
  Catalog2026Item,
  IdentityReview,
  IrComponentLink,
  IrCustomizationProfile,
  IrGraphEdge,
  IrGraphNode,
  IrOffer,
  IrProductMaster,
  IrVariant,
} from './identity-types.js';

/** The subset of pricelist_master.json this projection reads. */
export interface UpstreamPricelistMaster {
  metadata?: Record<string, unknown>;
  product_masters: UpstreamProductMaster[];
  product_families: UpstreamProductFamily[];
  catalog_offers: UpstreamCatalogOffer[];
  offer_product_links: UpstreamOfferProductLink[];
}

export interface UpstreamProductMaster {
  code: string;
  name_th: string | null;
  name_en: string | null;
  display_name: string | null;
  base_signature: string | null;
  product_family_id: string | null;
  source_group_id: string | null;
  source_status: string | null;
  colors: string[] | null;
}

export interface UpstreamProductFamily {
  code: string;
  source_group_id: string | null;
  name_th: string | null;
  name_en: string | null;
}

export interface UpstreamCatalogOffer {
  code: string;
  name_th: string | null;
  name_en: string | null;
  name: string | null;
  description: string | null;
  offer_kind: string | null;
  status: string | null;
  branding: string | null;
  image: string | null;
  rmb: number | null;
}

export interface UpstreamOfferProductLink {
  product_code: string;
  offer_code: string;
}

export interface ProjectionStats {
  productMasters: number;
  variants: number;
  offers: number;
  componentLinks: number;
  customizationProfiles: number;
  catalogItems: number;
  attributeValues: number;
  /** 1 by construction — see the fidelity note at the top of this file. */
  variantsPerMaster: number;
  /** Links whose product_code is absent from product_masters; dropped, never silently mapped. */
  droppedOrphanLinks: number;
  /** Links naming an offer absent from catalog_offers; dropped. */
  droppedOrphanOffers: number;
}

export interface ProjectionResult {
  catalog: Catalog2026Item[];
  identity: IdentityReview;
  stats: ProjectionStats;
}

/** Thai branding labels the graph builder knows, mapped to its CustomizationOption ids. */
const BRANDING_TO_OPTION: Record<string, string> = {
  'สกรีนโลโก้': 'screen_logo',
  'เลเซอร์โลโก้': 'laser_logo',
  'การ์ดข้อความ': 'message_card',
};

const hash20 = (seed: string): string =>
  createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 20).toUpperCase();

export const variantIdFor = (productCode: string): string => `PHYSICAL_VARIANT_${hash20(`variant|${productCode}`)}`;
export const componentLinkIdFor = (offerCode: string, productCode: string, position: number): string =>
  `COMPONENT_LINK_${hash20(`link|${offerCode}|${productCode}|${position}`)}`;
export const profileIdFor = (optionIds: string[]): string => `CUSTOMIZATION_${hash20(`profile|${optionIds.join(',')}`)}`;
export const attributeIdFor = (type: string, value: string): string =>
  `ATTRIBUTE_${hash20(`attr|${type}|${value.toLowerCase()}`)}`;
export const offerIdFor = (code: string): string => `OFFER_${code.trim().toUpperCase()}`;

function parseBranding(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function brandingOptionIds(branding: string[]): string[] {
  const ids = new Set<string>();
  for (const label of branding) {
    const id = BRANDING_TO_OPTION[label];
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Projects the upstream export. Pure: no filesystem, no clock — the caller supplies everything,
 * so this is directly unit-testable and byte-deterministic, which is what makes ingest's
 * input-hash skip logic trustworthy across upstream re-exports.
 */
export function projectUpstream(src: UpstreamPricelistMaster): ProjectionResult {
  const masters = src.product_masters ?? [];
  const offers = src.catalog_offers ?? [];
  const links = src.offer_product_links ?? [];

  const masterByCode = new Map(masters.map((m) => [m.code, m]));
  const offerByCode = new Map(offers.map((o) => [o.code.trim().toUpperCase(), o]));

  // --- component links: group the flat upstream links by offer, in stable order --------------
  // Upstream links carry no quantity or position (they are a flattened
  // `smartgift_model.offer_codes` membership list), so quantity is 1 and position is the
  // deterministic sort order rather than a fabricated one.
  const linksByOffer = new Map<string, UpstreamOfferProductLink[]>();
  let droppedOrphanLinks = 0;
  let droppedOrphanOffers = 0;
  for (const l of links) {
    if (!masterByCode.has(l.product_code)) {
      droppedOrphanLinks += 1;
      continue;
    }
    const key = l.offer_code.trim().toUpperCase();
    if (!offerByCode.has(key)) {
      droppedOrphanOffers += 1;
      continue;
    }
    const bucket = linksByOffer.get(key);
    if (bucket) bucket.push(l);
    else linksByOffer.set(key, [l]);
  }
  for (const bucket of linksByOffer.values()) bucket.sort((a, b) => a.product_code.localeCompare(b.product_code));

  const componentLinks: IrComponentLink[] = [];
  const componentLinkIdsByOffer = new Map<string, string[]>();
  const offerIdsByProduct = new Map<string, string[]>();
  // Sorting the offer codes too, not just the links inside each one: Map iteration follows
  // insertion order, so without this the emitted array order would track the upstream row order.
  // That would change the artifact's bytes — and therefore ingest's input hash — on a re-export
  // that reordered rows but changed no data, forcing a full reingest for nothing.
  const orderedOfferCodes = [...linksByOffer.keys()].sort((a, b) => a.localeCompare(b));
  for (const offerCode of orderedOfferCodes) {
    const bucket = linksByOffer.get(offerCode)!;
    const offerId = offerIdFor(offerCode);
    const ids: string[] = [];
    bucket.forEach((l, i) => {
      const master = masterByCode.get(l.product_code)!;
      const typeId = master.product_family_id ?? null;
      const id = componentLinkIdFor(offerCode, l.product_code, i + 1);
      ids.push(id);
      componentLinks.push({
        componentLinkId: id,
        offerId,
        productId: l.product_code,
        physicalVariantId: variantIdFor(l.product_code),
        quantity: 1,
        position: i + 1,
        role: typeId ?? 'unclassified',
        typeId,
      });
      const existing = offerIdsByProduct.get(l.product_code);
      if (existing) existing.push(offerId);
      else offerIdsByProduct.set(l.product_code, [offerId]);
    });
    componentLinkIdsByOffer.set(offerId, ids);
  }

  // --- customization profiles: deduped by their option-id set --------------------------------
  const profileByKey = new Map<string, IrCustomizationProfile & { offerIds: string[] }>();
  const profileIdByOffer = new Map<string, string>();
  for (const o of offers) {
    const optionIds = brandingOptionIds(parseBranding(o.branding));
    if (!optionIds.length) continue;
    const key = optionIds.join(',');
    const offerId = offerIdFor(o.code);
    const existing = profileByKey.get(key);
    if (existing) existing.offerIds.push(offerId);
    else profileByKey.set(key, { customizationProfileId: profileIdFor(optionIds), optionIds, offerIds: [offerId] });
    profileIdByOffer.set(offerId, profileByKey.get(key)!.customizationProfileId);
  }
  const customizationProfiles: IrCustomizationProfile[] = [...profileByKey.values()].map((p) => ({
    customizationProfileId: p.customizationProfileId,
    optionIds: p.optionIds,
  }));

  // --- offers ---------------------------------------------------------------------------------
  const irOffers: IrOffer[] = offers.map((o) => {
    const offerId = offerIdFor(o.code);
    const linkIds = componentLinkIdsByOffer.get(offerId) ?? [];
    const kind: 'set' | 'single' = o.offer_kind === 'single' ? 'single' : 'set';
    // A `single` offer is one product sold on its own; bind productId only when the membership is
    // unambiguous, otherwise the SINGLE_OF edge would assert a relationship we cannot prove.
    const bucket = linksByOffer.get(o.code.trim().toUpperCase()) ?? [];
    const productId = kind === 'single' && bucket.length === 1 ? bucket[0].product_code : null;
    const profileId = profileIdByOffer.get(offerId);
    return {
      offerId,
      sourceCode: o.code,
      offerKind: kind,
      status: o.status ?? 'unclassified',
      productId,
      componentLinkIds: linkIds,
      customizationProfileIds: profileId ? [profileId] : [],
    };
  });

  // --- product masters + variants ------------------------------------------------------------
  const productMasters: IrProductMaster[] = [];
  const variants: IrVariant[] = [];
  for (const m of masters) {
    const variantId = variantIdFor(m.code);
    const colors = (m.colors ?? []).filter((c) => typeof c === 'string' && c.trim());
    productMasters.push({
      productId: m.code,
      displayName: m.display_name ?? m.name_en ?? m.name_th ?? m.code,
      englishName: m.name_en ?? null,
      baseSignature: m.base_signature ?? '',
      status: m.source_status ?? 'unclassified',
      typeId: m.product_family_id ?? null,
      physicalVariantIds: [variantId],
      offerIds: [...new Set(offerIdsByProduct.get(m.code) ?? [])].sort(),
    });
    variants.push({
      physicalVariantId: variantId,
      productId: m.code,
      status: m.source_status ?? 'unclassified',
      attributes: { colors: colors.length ? colors : null, sizes: null, materials: null },
    });
  }

  // --- identity graph: AttributeValue colours + CatalogOffer rmb ------------------------------
  // build-graph reads exactly two things from `graph`: HAS_ATTRIBUTE edges (to materialise
  // AttributeValue nodes) and the `rmb` prop on CatalogOffer nodes. Emitting only those keeps the
  // artifact honest about what it actually carries.
  const graphNodes: IrGraphNode[] = [];
  const graphEdges: IrGraphEdge[] = [];
  const seenAttribute = new Set<string>();
  for (const v of variants) {
    for (const color of v.attributes.colors ?? []) {
      const attrId = attributeIdFor('color', color);
      if (!seenAttribute.has(attrId)) {
        seenAttribute.add(attrId);
        graphNodes.push({ id: attrId, label: 'AttributeValue', props: { attributeType: 'color', value: color } });
      }
      graphEdges.push({ from: v.physicalVariantId, to: attrId, rel: 'HAS_ATTRIBUTE', props: {} });
    }
  }
  for (const o of offers) {
    graphNodes.push({ id: offerIdFor(o.code), label: 'CatalogOffer', props: { rmb: o.rmb ?? null } });
  }

  // --- semantic catalog -----------------------------------------------------------------------
  // `category` is not read by build-graph; it is filled from the offer's dominant component group
  // so the artifact carries real information rather than a placeholder.
  const catalog: Catalog2026Item[] = offers.map((o) => {
    const bucket = linksByOffer.get(o.code.trim().toUpperCase()) ?? [];
    const counts = new Map<string, number>();
    for (const l of bucket) {
      const g = masterByCode.get(l.product_code)?.source_group_id;
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    let category = '';
    let best = 0;
    for (const [g, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (c > best) {
        best = c;
        category = g;
      }
    }
    return {
      code: o.code,
      name: o.name_th ?? o.name ?? o.code,
      englishName: o.name_en ?? '',
      category,
      description: o.description ?? '',
      image: o.image ?? null,
      branding: parseBranding(o.branding),
    };
  });

  return {
    catalog,
    identity: {
      productMasters,
      variants,
      offers: irOffers,
      componentLinks,
      customizationProfiles,
      graph: { nodes: graphNodes, edges: graphEdges },
    },
    stats: {
      productMasters: productMasters.length,
      variants: variants.length,
      offers: irOffers.length,
      componentLinks: componentLinks.length,
      customizationProfiles: customizationProfiles.length,
      catalogItems: catalog.length,
      attributeValues: seenAttribute.size,
      variantsPerMaster: 1,
      droppedOrphanLinks,
      droppedOrphanOffers,
    },
  };
}
