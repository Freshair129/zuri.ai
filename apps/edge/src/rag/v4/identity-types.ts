// Subset of identity-review.json actually consumed by build-graph.ts.

export interface IrProductMaster {
  productId: string;
  displayName: string;
  englishName: string | null;
  baseSignature: string;
  status: string;
  typeId: string | null;
  physicalVariantIds: string[];
  offerIds: string[];
}

export interface IrVariant {
  physicalVariantId: string;
  productId: string;
  status: string;
  attributes: { colors: string[] | null; sizes: string[] | null; materials: string[] | null };
}

export interface IrOffer {
  offerId: string;
  sourceCode: string;
  offerKind: 'set' | 'single';
  status: string;
  productId: string | null;
  componentLinkIds: string[];
  customizationProfileIds: string[];
}

export interface IrComponentLink {
  componentLinkId: string;
  offerId: string;
  productId: string;
  physicalVariantId: string;
  quantity: number;
  position: number;
  role: string;
  typeId: string | null;
}

export interface IrCustomizationProfile {
  customizationProfileId: string;
  optionIds: string[];
}

export interface IrGraphNode {
  id: string;
  label: string;
  props: Record<string, unknown>;
}

export interface IrGraphEdge {
  from: string;
  to: string;
  rel: string;
  props: Record<string, unknown>;
}

export interface IdentityReview {
  productMasters: IrProductMaster[];
  variants: IrVariant[];
  offers: IrOffer[];
  componentLinks: IrComponentLink[];
  customizationProfiles: IrCustomizationProfile[];
  graph: { nodes: IrGraphNode[]; edges: IrGraphEdge[] };
}

export interface Catalog2026Item {
  code: string;
  name: string;
  englishName: string;
  category: string;
  description: string;
  image: string | null;
  branding: string[];
}
