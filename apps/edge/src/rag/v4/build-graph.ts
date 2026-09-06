import type { GraphBatch, GraphEdge, GraphNode, NodeLabel, SourceRef } from './schema.js';
import { TYPE_UNCLASSIFIED, SKU_PKG_GIFTBOX_STD, catGroupId, typeNodeId, offerNodeId, cskuId, customId, edgeId } from './schema.js';
import { assignDisplayCodes, stableSkuId, type SkuInput } from './sku.js';
import { validateCategoryGroupMap, validateTypeAliases, type CategoryGroupMap, type TypeAliases } from './config.js';
import { NAME_RX, type ParsedFlowAccount } from './flowaccount.js';
import type { Catalog2026Item, IdentityReview, IrComponentLink } from './identity-types.js';
import { modelPassage, offerPassage } from './embed-text.js';
import { ladderFromCsku } from './price.js';
import type { PriceTier } from './search.js';

export interface BuildInputs {
  identity: IdentityReview;
  catalog: Catalog2026Item[];
  flowaccount: ParsedFlowAccount;
  categoryMap: CategoryGroupMap;
  aliases: TypeAliases;
  refs: { identity: SourceRef; catalog: SourceRef; flowaccount: SourceRef };
}

const CUSTOM_OPTIONS: Array<{ id: string; name_th: string }> = [
  { id: 'screen_logo', name_th: 'สกรีนโลโก้' },
  { id: 'laser_logo', name_th: 'เลเซอร์โลโก้' },
  { id: 'message_card', name_th: 'การ์ดข้อความ' },
];
const BRANDING_NAME_TO_OPTION: Record<string, string> = Object.fromEntries(
  CUSTOM_OPTIONS.map((o) => [o.name_th, o.id]),
);

function mostCommon<T>(items: T[]): T | null {
  if (!items.length) return null;
  const counts = new Map<T, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function stripTrailingCode(name: string): string {
  const rx = new RegExp(NAME_RX.source, 'i');
  const m = rx.exec(name.trim());
  if (!m || m.index === undefined) return name.trim();
  return name.slice(0, m.index).trim();
}

export function buildGraphV4(inputs: BuildInputs): GraphBatch {
  const { identity, catalog, flowaccount, categoryMap, aliases, refs } = inputs;

  const observedTypeIds = Array.from(
    new Set<string>([
      ...identity.productMasters.map((m) => m.typeId).filter((t): t is string => !!t),
      ...identity.componentLinks.map((l) => l.typeId).filter((t): t is string => !!t),
    ]),
  );
  validateCategoryGroupMap(categoryMap, observedTypeIds);
  validateTypeAliases(aliases, observedTypeIds);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const mkRef = (base: SourceRef, rowKey: string): SourceRef => ({ ...base, rowKey });
  const identityRef = refs.identity;
  const catalogRef = refs.catalog;
  const flowRef = refs.flowaccount;

  // --- Step 2: CategoryGroup, ProductType, sentinel -------------------------------------
  for (const g of categoryMap.groups) {
    const id = catGroupId(g.id);
    nodes.push({ id, labels: ['CategoryGroup'], props: { name_th: g.name_th, name_en: g.name_en, order: g.order, sourceRef: mkRef(identityRef, id) } });
  }
  const typeNameThById = new Map<string, string>();
  for (const t of aliases.types) {
    const id = typeNodeId(t.typeId);
    typeNameThById.set(t.typeId, t.name_th);
    const groupId = categoryMap.typeToGroup[t.typeId];
    nodes.push({
      id,
      labels: ['ProductType'],
      props: { typeId: t.typeId, name_th: t.name_th, name_en: t.name_en, aliases_th: t.aliases_th, aliases_en: t.aliases_en, groupId, sourceRef: mkRef(identityRef, id) },
    });
    edges.push({ id: edgeId('IN_GROUP', id, catGroupId(groupId)), from: id, to: catGroupId(groupId), rel: 'IN_GROUP' });
  }
  nodes.push({ id: TYPE_UNCLASSIFIED, labels: ['TypeSentinel'], props: { sourceRef: mkRef(identityRef, TYPE_UNCLASSIFIED) } });

  // --- Step 3: ProductModel ---------------------------------------------------------------
  const linksByProduct = new Map<string, IrComponentLink[]>();
  for (const l of identity.componentLinks) {
    (linksByProduct.get(l.productId) ?? linksByProduct.set(l.productId, []).get(l.productId)!).push(l);
  }
  const variantsByProduct = new Map<string, typeof identity.variants>();
  for (const v of identity.variants) {
    (variantsByProduct.get(v.productId) ?? variantsByProduct.set(v.productId, []).get(v.productId)!).push(v);
  }
  const mastersById = new Map(identity.productMasters.map((m) => [m.productId, m]));
  const modelTypeIdMap = new Map<string, string | null>();

  for (const m of identity.productMasters) {
    let usedTypeId: string | null = null;
    let inTypeSource: string;
    let inTypeTargetId: string;
    if (m.typeId) {
      usedTypeId = m.typeId;
      inTypeSource = 'identity_review.typeId';
      inTypeTargetId = typeNodeId(m.typeId);
    } else {
      const links = linksByProduct.get(m.productId) ?? [];
      const derived = mostCommon(links.map((l) => l.typeId ?? l.role).filter((t) => t !== 'unclassified'));
      if (derived) {
        usedTypeId = derived;
        inTypeSource = 'component_role';
        inTypeTargetId = typeNodeId(derived);
      } else {
        usedTypeId = null;
        inTypeSource = 'none';
        inTypeTargetId = TYPE_UNCLASSIFIED;
      }
    }
    modelTypeIdMap.set(m.productId, usedTypeId);
    const groupId = usedTypeId ? categoryMap.typeToGroup[usedTypeId] ?? null : null;
    const variants = variantsByProduct.get(m.productId) ?? [];
    const colors = Array.from(new Set(variants.flatMap((v) => v.attributes.colors ?? [])));

    nodes.push({
      id: m.productId,
      labels: ['ProductModel'],
      props: {
        displayName: m.displayName,
        englishName: m.englishName,
        typeId: usedTypeId,
        groupId,
        status: m.status,
        baseSignature: m.baseSignature,
        colors,
        sourceRef: mkRef(identityRef, m.productId),
      },
    });
    edges.push({ id: edgeId('IN_TYPE', m.productId, inTypeTargetId), from: m.productId, to: inTypeTargetId, rel: 'IN_TYPE', props: { source: inTypeSource } });
  }

  // --- Step 4: PhysicalVariant + AttributeValue --------------------------------------------
  for (const v of identity.variants) {
    nodes.push({
      id: v.physicalVariantId,
      labels: ['PhysicalVariant'],
      props: {
        colors: v.attributes.colors ?? [],
        sizes: v.attributes.sizes ?? [],
        materials: v.attributes.materials ?? [],
        status: v.status,
        productId: v.productId,
        sourceRef: mkRef(identityRef, v.physicalVariantId),
      },
    });
    edges.push({ id: edgeId('HAS_VARIANT', v.productId, v.physicalVariantId), from: v.productId, to: v.physicalVariantId, rel: 'HAS_VARIANT' });
  }
  const graphNodesById = new Map(identity.graph.nodes.map((n) => [n.id, n]));
  const seenAttribute = new Set<string>();
  for (const e of identity.graph.edges) {
    if (e.rel !== 'HAS_ATTRIBUTE') continue;
    const attrNode = graphNodesById.get(e.to);
    if (!attrNode) continue;
    if (!seenAttribute.has(e.to)) {
      seenAttribute.add(e.to);
      nodes.push({
        id: e.to,
        labels: ['AttributeValue'],
        props: { attributeType: attrNode.props.attributeType, value: attrNode.props.value, sourceRef: mkRef(identityRef, e.to) },
      });
    }
    edges.push({ id: edgeId('HAS_ATTRIBUTE', e.from, e.to), from: e.from, to: e.to, rel: 'HAS_ATTRIBUTE' });
  }

  // --- Step 5: PhysicalSKU -----------------------------------------------------------------
  const skuInputs: SkuInput[] = identity.variants.map((v) => {
    const master = mastersById.get(v.productId)!;
    return {
      productId: v.productId,
      physicalVariantId: v.physicalVariantId,
      typeId: modelTypeIdMap.get(v.productId) ?? null,
      englishName: master.englishName,
      colors: v.attributes.colors ?? [],
      sizes: v.attributes.sizes ?? [],
      materials: v.attributes.materials ?? [],
    };
  });
  const displayCodes = assignDisplayCodes(skuInputs);
  for (const v of identity.variants) {
    const skuId = stableSkuId(v.productId, v.physicalVariantId);
    nodes.push({
      id: skuId,
      labels: ['PhysicalSKU'],
      props: { displayCode: displayCodes.get(skuId), modelId: v.productId, variantId: v.physicalVariantId, kind: 'product', sourceRef: mkRef(identityRef, skuId) },
    });
    edges.push({ id: edgeId('HAS_SKU', v.physicalVariantId, skuId), from: v.physicalVariantId, to: skuId, rel: 'HAS_SKU' });
  }
  nodes.push({
    id: SKU_PKG_GIFTBOX_STD,
    labels: ['PhysicalSKU'],
    props: { displayCode: 'SKU-PKG-GIFTBOX-STD', modelId: null, variantId: null, kind: 'packaging', sourceRef: mkRef(identityRef, SKU_PKG_GIFTBOX_STD) },
  });

  // --- Step 6-9: CatalogOffer (from identity) -----------------------------------------------
  const catalogByCode = new Map<string, Catalog2026Item>();
  for (const c of catalog) catalogByCode.set(c.code.toUpperCase(), c);
  const linksByOffer = new Map<string, IrComponentLink[]>();
  for (const l of identity.componentLinks) {
    (linksByOffer.get(l.offerId) ?? linksByOffer.set(l.offerId, []).get(l.offerId)!).push(l);
  }
  const profilesById = new Map(identity.customizationProfiles.map((p) => [p.customizationProfileId, p]));
  const graphOfferNodeById = new Map(identity.graph.nodes.filter((n) => n.label === 'CatalogOffer').map((n) => [n.id, n]));

  for (const o of CUSTOM_OPTIONS) {
    const id = customId(o.id);
    nodes.push({ id, labels: ['CustomizationOption'], props: { name_th: o.name_th, sourceRef: mkRef(identityRef, id) } });
  }

  const offerIdsExisting = new Set<string>();
  for (const o of identity.offers) {
    const id = offerNodeId(o.sourceCode);
    offerIdsExisting.add(id);
    const catItem = catalogByCode.get(o.sourceCode.toUpperCase()) ?? null;
    const master = o.productId ? mastersById.get(o.productId) : undefined;
    const name_en = catItem?.englishName ?? master?.englishName ?? o.sourceCode;
    const image = catItem?.image ?? null;
    const branding = catItem?.branding ?? [];
    const rmb = (graphOfferNodeById.get(id)?.props?.rmb as number | undefined) ?? null;

    const links = (linksByOffer.get(o.offerId) ?? []).slice().sort((a, b) => a.position - b.position);
    const componentTypeIds = Array.from(new Set(links.map((l) => l.typeId ?? l.role).filter((t) => t !== 'unclassified')));

    const props: Record<string, unknown> = {
      code: o.sourceCode,
      name_th: catItem?.name ?? null,
      name_en,
      description: catItem?.description ?? null,
      image,
      offerKind: o.offerKind,
      rmb,
      branding,
      status: o.status,
      origin: 'catalog',
      componentTypeIds,
      sourceRef: mkRef(identityRef, id),
    };
    if (catItem) props.catalogRef = mkRef(catalogRef, o.sourceCode.toUpperCase());
    nodes.push({ id, labels: ['CatalogOffer'], props });

    for (const l of links) {
      const skuId = stableSkuId(l.productId, l.physicalVariantId);
      edges.push({
        id: edgeId('CONTAINS', id, skuId, l.componentLinkId),
        from: id,
        to: skuId,
        rel: 'CONTAINS',
        props: { qty: l.quantity, position: l.position, role: l.role, componentLinkId: l.componentLinkId },
      });
    }
    if (branding.length) {
      edges.push({
        id: edgeId('CONTAINS', id, SKU_PKG_GIFTBOX_STD),
        from: id,
        to: SKU_PKG_GIFTBOX_STD,
        rel: 'CONTAINS',
        props: { qty: 1, position: 99, role: 'packaging' },
      });
    }
    if (o.offerKind === 'single' && o.productId) {
      edges.push({ id: edgeId('SINGLE_OF', id, o.productId), from: id, to: o.productId, rel: 'SINGLE_OF' });
    }

    const optionIds = new Set<string>();
    for (const pid of o.customizationProfileIds) {
      const profile = profilesById.get(pid);
      if (profile) for (const opt of profile.optionIds) optionIds.add(opt);
    }
    for (const b of branding) {
      const optId = BRANDING_NAME_TO_OPTION[b];
      if (optId) optionIds.add(optId);
    }
    for (const optId of optionIds) {
      edges.push({ id: edgeId('CUSTOMIZABLE_WITH', id, customId(optId)), from: id, to: customId(optId), rel: 'CUSTOMIZABLE_WITH' });
    }
  }

  // --- Step 10: CommercialSKU (from FlowAccount) --------------------------------------------
  // FlowAccount-only offers have no identity-review component links, so their type is read off
  // the FlowAccount name via the alias dictionary ("เครื่องนวดคอ TBY01(P-14)" → neck_massager).
  // Without this they carry componentTypeIds: [] — invisible to the exclude filter and embedded
  // with an empty "ประกอบด้วย:" clause, which buries the only priced offers of several types.
  const aliasPairs: Array<[string, string]> = [];
  for (const t of aliases.types) {
    for (const a of [t.name_th, t.name_en, ...t.aliases_th, ...t.aliases_en]) {
      if (a) aliasPairs.push([a.normalize('NFKC').toLowerCase(), t.typeId]);
    }
  }
  aliasPairs.sort((a, b) => b[0].length - a[0].length);
  const typesFromName = (name: string): string[] => {
    const hay = name.normalize('NFKC').toLowerCase();
    const found: string[] = [];
    for (const [alias, typeId] of aliasPairs) {
      if (!found.includes(typeId) && hay.includes(alias)) found.push(typeId);
    }
    return found;
  };
  flowaccount.lines.forEach((line) => {
    if (line.bucket === 'non_giftset') return;
    const targetOfferId = offerNodeId(line.base);
    if (!offerIdsExisting.has(targetOfferId)) {
      offerIdsExisting.add(targetOfferId);
      nodes.push({
        id: targetOfferId,
        labels: ['CatalogOffer'],
        props: {
          code: line.base,
          name_th: stripTrailingCode(line.flowAccountName),
          name_en: null,
          description: null,
          image: null,
          offerKind: 'set',
          rmb: null,
          branding: [],
          status: 'flowaccount_only',
          origin: 'flowaccount_only',
          componentTypeIds: typesFromName(line.flowAccountName),
          sourceRef: mkRef(identityRef, targetOfferId),
        },
      });
    }
    const seed = line.flowAccountCode ?? `${line.base}|${line.rowIndex}`;
    const id = cskuId(seed);
    nodes.push({
      id,
      labels: ['CommercialSKU'],
      props: {
        flowAccountCode: line.flowAccountCode,
        offerCode: line.base,
        priceListGroup: line.priceListGroup,
        qtyTier: line.qtyTier,
        unitPrice: line.unitPrice,
        unitPriceWithVat: line.unitPriceWithVat,
        priceMissing: line.priceMissing,
        flowAccountName: line.flowAccountName,
        exportDate: '2026-06-21',
        sourceRef: mkRef(flowRef, `row:${line.rowIndex}`),
      },
    });
    edges.push({ id: edgeId('PRICED_AS', targetOfferId, id), from: targetOfferId, to: id, rel: 'PRICED_AS' });
  });

  // --- Step 11: denormalize price tiers onto CatalogOffer/ProductModel props (Wave-4 A.1) --
  // search.ts's Phase 1 reads these props directly instead of traversing PRICED_AS/SINGLE_OF/
  // CONTAINS at query time (§5.7 latency fix) — see spec appendix / plan Wave-4 item A.
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const offerPriceTiers = new Map<string, PriceTier[]>();
  for (const n of nodes) {
    if (n.labels.includes('CatalogOffer')) offerPriceTiers.set(n.id, []);
  }
  for (const e of edges) {
    if (e.rel !== 'PRICED_AS') continue;
    const csku = nodesById.get(e.to);
    const arr = offerPriceTiers.get(e.from);
    if (!csku || !arr) continue;
    arr.push(...ladderFromCsku([{ props: csku.props }]));
  }
  for (const [offerId, tiers] of offerPriceTiers) {
    tiers.sort((a, b) => (a.qtyTier ?? 1e9) - (b.qtyTier ?? 1e9));
    nodesById.get(offerId)!.props.priceTiers = tiers;
  }

  // skuId -> modelId, so a CONTAINS edge (Offer -> PhysicalSKU) can be attributed back to the
  // model that owns that SKU (skips the packaging SKU, whose modelId is null).
  const skuToModel = new Map<string, string>();
  for (const si of skuInputs) skuToModel.set(stableSkuId(si.productId, si.physicalVariantId), si.productId);

  const singleOfByModel = new Map<string, Set<string>>(); // modelId -> offerIds (SINGLE_OF)
  const containsByModel = new Map<string, Set<string>>(); // modelId -> offerIds (via CONTAINS -> SKU)
  for (const e of edges) {
    if (e.rel === 'SINGLE_OF') {
      (singleOfByModel.get(e.to) ?? singleOfByModel.set(e.to, new Set()).get(e.to)!).add(e.from);
    } else if (e.rel === 'CONTAINS') {
      const modelId = skuToModel.get(e.to);
      if (modelId) (containsByModel.get(modelId) ?? containsByModel.set(modelId, new Set()).get(modelId)!).add(e.from);
    }
  }

  for (const n of nodes) {
    if (!n.labels.includes('ProductModel')) continue;
    const singleOffers = [...(singleOfByModel.get(n.id) ?? [])];
    const containsOffers = [...(containsByModel.get(n.id) ?? [])];

    const offerCodesSet = new Set<string>();
    for (const oid of [...singleOffers, ...containsOffers]) {
      const code = nodesById.get(oid)?.props.code as string | undefined;
      if (code) offerCodesSet.add(code);
    }

    let priceSource: 'offer' | 'via_offer' | null = null;
    let priceTiers: PriceTier[] = [];
    const singleTiers = singleOffers.flatMap((oid) => offerPriceTiers.get(oid) ?? []);
    if (singleTiers.length) {
      priceSource = 'offer';
      priceTiers = singleTiers;
    } else {
      const viaTiers = containsOffers.flatMap((oid) => offerPriceTiers.get(oid) ?? []);
      if (viaTiers.length) {
        priceSource = 'via_offer';
        priceTiers = viaTiers;
      }
    }
    priceTiers = [...priceTiers].sort((a, b) => (a.qtyTier ?? 1e9) - (b.qtyTier ?? 1e9));

    n.props.priceTiers = priceTiers;
    n.props.priceSource = priceSource;
    n.props.offerCodes = [...offerCodesSet].sort();
  }

  // --- Step 12: sort + stats -----------------------------------------------------------------
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const countBy = (label: NodeLabel) => nodes.filter((n) => n.labels.includes(label)).length;
  const stats: Record<string, number> = {
    CategoryGroup: countBy('CategoryGroup'),
    ProductType: countBy('ProductType'),
    ProductModel: countBy('ProductModel'),
    PhysicalVariant: countBy('PhysicalVariant'),
    PhysicalSKU: countBy('PhysicalSKU'),
    CatalogOffer: countBy('CatalogOffer'),
    CatalogOfferFlowAccountOnly: nodes.filter((n) => n.labels.includes('CatalogOffer') && n.props.origin === 'flowaccount_only').length,
    CommercialSKU: countBy('CommercialSKU'),
    CustomizationOption: countBy('CustomizationOption'),
    AttributeValue: countBy('AttributeValue'),
    edges: edges.length,
  };

  return { nodes, edges, stats };
}

export function embeddableNodes(batch: GraphBatch): Array<{ id: string; text: string }> {
  const typeNameThById = new Map(
    batch.nodes.filter((n) => n.labels.includes('ProductType')).map((n) => [n.props.typeId as string, n.props.name_th as string]),
  );
  const out: Array<{ id: string; text: string }> = [];
  for (const n of batch.nodes) {
    if (n.labels.includes('ProductModel')) {
      const typeId = n.props.typeId as string | null;
      const typeNameTh = (typeId && typeNameThById.get(typeId)) || 'ไม่ระบุหมวด';
      out.push({ id: n.id, text: modelPassage(n, typeNameTh) });
    } else if (n.labels.includes('CatalogOffer')) {
      const componentTypeIds = (n.props.componentTypeIds as string[]) ?? [];
      const names = componentTypeIds.map((t) => typeNameThById.get(t) ?? t);
      out.push({ id: n.id, text: offerPassage(n, names) });
    }
  }
  return out;
}
