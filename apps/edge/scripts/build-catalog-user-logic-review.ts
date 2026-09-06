import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { buildCanonicalCatalog } from '../src/rag/catalog-manifest.js';
import {
  buildOwnerLogicReviewFromProducts,
} from '../src/rag/catalog-user-logic-review.js';

const pricingPath = path.resolve(
  process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
    '../smartgift-pricing/public/catalog/giftset.json'
);
const configuredSemanticPath =
  process.env.SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH ||
  'C:/Users/freshair/Downloads/catalog-2026.json';
const semanticPath = fs.existsSync(configuredSemanticPath)
  ? path.resolve(configuredSemanticPath)
  : undefined;
const oldArtifactPath = path.resolve(
  process.env.GENESIS_IDENTITY_REVIEW_PATH ||
    './data/catalog_identity_review_v1/identity-review.json'
);
const outputPath = path.resolve(
  process.env.GENESIS_USER_LOGIC_REVIEW_PATH ||
    './data/catalog_identity_review_user_logic_v1/identity-review.json'
);
const reportPath = path.resolve(
  process.env.GENESIS_USER_LOGIC_REPORT_PATH ||
    './docs/GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT.md'
);

function sha256(filePath: string): string | null {
  return fs.existsSync(filePath)
    ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    : null;
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function report(review: ReturnType<typeof buildOwnerLogicReviewFromProducts>): string {
  const counts = review.counts;
  return `---
id: "GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT"
version: "0.1.0b"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T00:00:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Side-by-side SmartGift catalog review using owner product-separation logic"
  spec: "GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC"
  decision: "review_only"
---

# SmartGift Catalog — Owner Logic Side-by-Side Review Report

## 1. Boundary

ผลนี้เป็น projection ใหม่สำหรับเปรียบเทียบเท่านั้น ไม่เขียนทับผลเดิม

- Snapshot: \`${review.snapshotId}\`
- Canonical offers: ${counts.canonicalOfferCount}
- Old artifact: \`${review.basis.oldArtifactPath}\`
- Old artifact SHA256: \`${review.basis.oldArtifactSha256 || 'unavailable'}\`
- New artifact: \`data/catalog_identity_review_user_logic_v1/identity-review.json\`
- Decision: \`review_only\`
- Active family_v2/taxonomy/price/quote/stock/delivery: unchanged

## 2. Before and after

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Atomic ProductMaster | ${counts.oldAtomicProductCount} | ${counts.newAtomicProductCount} | ${counts.newAtomicProductCount - counts.oldAtomicProductCount} |
| Auto identity status | ${counts.oldAutoCount} | ${counts.newAutoCount} | ${counts.newAutoCount - counts.oldAutoCount} |
| Classified type | ${counts.oldClassifiedTypeCount} | ${counts.newClassifiedTypeCount} | ${counts.newClassifiedTypeCount - counts.oldClassifiedTypeCount} |
| Review-required ProductMaster | ${counts.oldReviewRequiredCount} | ${counts.newReviewRequiredCount} | ${counts.newReviewRequiredCount - counts.oldReviewRequiredCount} |
| Unclassified ProductMaster | ${counts.oldUnclassifiedCount} | ${counts.newUnclassifiedCount} | ${counts.newUnclassifiedCount - counts.oldUnclassifiedCount} |
| Single offer | — | ${counts.singleOfferCount} | — |
| Set offer | — | ${counts.setOfferCount} | — |
| Unclassified offer status | — | ${counts.unclassifiedOfferCount} | — |
| Component links | — | ${counts.componentLinkCount} | — |
| Changed offers | — | ${counts.changedOfferCount} | — |
| Changed ProductMasters | — | ${counts.changedProductMasterCount} | — |

## 3. Separation rule

\`ProductMaster\` คือสินค้ากายภาพหลักหนึ่งแบบ; สี ขนาด วัสดุ รุ่น และ branding
เป็น variant/option; SKU เป็น \`CatalogOffer\`; Set เป็น offer ที่ชี้ไปยัง component
ด้วย \`CONTAINS_COMPONENT\` และไม่ถูกนับเป็น ProductMaster อีกหนึ่งรายการ

Hard rules ถูกใช้ก่อนคะแนน:

1. explicit set/bundle/lovers set เป็น set offer
2. logo/printing/laser/color/size/packaging ไม่สร้าง ProductMaster ใหม่
3. physical component/material/model/capacity conflict ห้าม auto-merge
4. ไม่มี physical anchor หรือ component evidence ให้คงเป็น unclassified
5. คำว่า box หรือ bag เดี่ยว ๆ ไม่ถือเป็น set โดยอัตโนมัติ

## 4. Scoring formula

### IdentityScore

\`IdentityScore = 0.35*AnchorAgreement + 0.25*ComponentAgreement + 0.20*PhysicalSpecAgreement + 0.10*NameDescriptionAgreement + 0.05*BrandingPackagingCompatibility + 0.05*SourceLineageSupport\`

- 90–100: candidate same product
- 75–89: review_required
- 0–74: unclassified/review according to evidence

### TypeScore

\`TypeScore = 0.50*ExplicitAliasEvidence + 0.25*DescriptionEvidence + 0.15*ParentSubtypeConsistency + 0.10*CrossOfferConsistency\`

- 90–100: classified
- 70–89: review_required
- 0–69: unclassified

Hard rules override both scores.

## 5. Owner mappings applied

| Source name | Type result |
|---|---|
| Wireless Earphone | audio > earphone |
| Nail Clipper Box | personal_care > nail_clipper |
| Lighter | lifestyle > lighter |
| 2026 Diary | stationery > notebook > diary |
| Backpack | bags > bag > backpack |
| Happy Valentine's Day Lovers Set | set offer; Coffee Mug ×1 + Neck Massage ×1 |
| Portable Tea Pot Gift Set | set offer; Tea Pot ×1 + Tea Cup ×3 |

## 6. Row-level evidence

The JSON artifact stores every offer comparison with old/new ProductMaster IDs,
old/new type IDs, offer kind, component links, factor breakdown, hard rules,
decision source, and change reasons.

## 7. Verification contract

- old artifact is immutable and its hash is recorded above
- new artifact is written to a separate directory
- all offers are represented exactly once as single or set
- graph relationships are stored in one canonical direction
- the same snapshot must replay to the same JSON hash

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Generated side-by-side owner-logic review report with scoring and before/after counts | pending | ATHER |
`;
}

const catalog = buildCanonicalCatalog({
  semanticPath,
  pricingPath,
});
const currentFamilyByOffer = new Map(
  catalog.families.flatMap((family) => family.offerIds.map((offerId) => [offerId, family.familyId] as const))
);
const review = buildOwnerLogicReviewFromProducts(catalog.products, {
  snapshotId: catalog.manifest.snapshotId,
  sourceLineage: catalog.manifest.sources.map(
    (source) => `${source.role}:${source.sha256}`
  ),
  currentFamilyByOffer,
  oldArtifactPath: path.relative(process.cwd(), oldArtifactPath).replaceAll('\\', '/'),
  oldArtifactSha256: sha256(oldArtifactPath) || undefined,
});

writeAtomic(outputPath, `${JSON.stringify(review, null, 2)}\n`);
writeAtomic(reportPath, report(review));

console.log(JSON.stringify({
  decision: 'review_only',
  outputPath,
  reportPath,
  oldArtifactPath,
  oldArtifactSha256: review.basis.oldArtifactSha256,
  snapshotId: review.snapshotId,
  counts: review.counts,
  graph: {
    nodeCount: review.graph.nodes.length,
    edgeCount: review.graph.edges.length,
  },
  activeRuntimeChanged: false,
  oldArtifactOverwritten: false,
}, null, 2));
