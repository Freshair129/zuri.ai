import { CardViewModel } from '../zuri-api/types.js';
import { validateCardViewModel } from '../cards/validator.js';
import { ALLOWED_CTA_DOMAINS } from '../cards/types.js';
import type { CardPayload } from '../answer/format-cards.js';

const ZURI = {
  amber: '#E8820C',
  amberDark: '#B86A08',
  cream: '#FFF8F0',
  ink: '#1A1710',
  blue: '#3D7A9E',
};

type FlexComponent = Record<string, unknown>;

function text(value: string, options: Record<string, unknown> = {}): FlexComponent {
  return { type: 'text', text: value.slice(0, 500), wrap: true, color: ZURI.ink, ...options };
}

/** Convert a bounded, already validated ViewModel into a conservative LINE Flex bubble. */
export function cardViewModelToFlex(card: CardViewModel): Record<string, unknown> {
  const body: FlexComponent[] = [
    // LINE Flex `text` has no `letterSpacing` property; sending it returns 400 "unknown field".
    text('ZURI REPORT', { size: 'xs', weight: 'bold', color: ZURI.amberDark }),
    text(card.title, { size: 'lg', weight: 'bold', margin: 'md' }),
  ];
  if (card.subtitle) body.push(text(card.subtitle, { size: 'sm', color: '#6B6258', margin: 'sm' }));

  for (const kpi of (card.kpis || []).slice(0, 3)) {
    body.push({
      type: 'box',
      layout: 'baseline',
      margin: 'md',
      contents: [
        text(kpi.label, { size: 'sm', color: '#6B6258', flex: 3 }),
        text(kpi.value, { size: 'sm', weight: 'bold', align: 'end', flex: 2 }),
      ],
    });
  }

  for (const item of (card.items || []).slice(0, 5)) {
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: [
        text(item.title, { size: 'sm', weight: 'bold' }),
        ...(item.subtitle ? [text(item.subtitle, { size: 'xs', color: '#6B6258', margin: 'xs' })] : []),
        ...(item.value ? [text(item.value, { size: 'sm', color: item.badge === 'MISSING' ? '#B3261E' : ZURI.ink, margin: 'xs' })] : []),
      ],
    });
  }

  for (const risk of (card.riskFlags || []).slice(0, 2)) {
    body.push(text(risk, { size: 'xs', color: '#B3261E', margin: 'md' }));
  }

  body.push(text(`แหล่งข้อมูล: ${card.sourceLabel} · ${new Date(card.asOf).toLocaleString('th-TH')}`, {
    size: 'xxs', color: '#6B6258', margin: 'lg',
  }));

  const footerButtons = card.ctaButtons.slice(0, 2).map((cta) => ({
    type: 'button', style: 'primary', color: ZURI.amber, height: 'sm',
    action: { type: 'uri', label: cta.label.slice(0, 20), uri: cta.uri },
  }));

  return {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: ZURI.cream, paddingAll: '16px', contents: [text('ซูริอยู่ข้างทีมเสมอ', { size: 'xs', color: ZURI.amberDark })] },
    body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footerButtons },
  };
}

/** Where a `modelCard` preview's "ดูตัวเลือก" button points — one of `ALLOWED_CTA_DOMAINS`, so the
 * governance check in `src/cards/validator.ts` (built for the report-card verticals, not this
 * one) still has something real to enforce rather than being bypassed by construction. */
const MODEL_CARD_CTA_BASE = ALLOWED_CTA_DOMAINS[0];

/**
 * Recasts a catalog-graph `CardPayload` (§5.7 search evidence, formatted by `format-cards.ts`)
 * into the org-wide `CardViewModel` governance shape, so `src/cards/validator.ts` — required
 * title/sourceLabel/asOf, an allowed CTA domain — has something to check `modelCard` against.
 *
 * `CardViewModel`'s CTA is `{ type: 'uri' }` only; there is no `postback` action in that type at
 * all. A product card's real "ดูตัวเลือก" action is a deep link into the same Model/Offer this
 * card came from, which a `uri` CTA expresses just as well as a LINE postback would for a
 * preview — the two are exercised together below.
 */
export function toCardViewModel(c: CardPayload): CardViewModel {
  const items: NonNullable<CardViewModel['items']> = [];
  if (c.colors.length) items.push({ title: 'สี', value: c.colors.join(', ') });
  if (c.sizes.length) items.push({ title: 'ไซซ์', value: c.sizes.join(', ') });

  const kpis: NonNullable<CardViewModel['kpis']> = [];
  if (c.selectedPrice) {
    const tierLabel = c.selectedPrice.qtyTier !== null ? `${c.selectedPrice.qtyTier} ชุด` : 'ราคาเริ่มต้น';
    kpis.push({ label: `ราคา/ชุด (${tierLabel})`, value: `${c.selectedPrice.unitPrice} บาท` });
  } else if (c.priceNote) {
    kpis.push({ label: 'ราคา', value: c.priceNote });
  }

  const operationalState: CardViewModel['operationalState'] =
    c.status === 'review_required' ? 'candidate' : c.status === 'auto' ? 'live' : 'snapshot';

  return {
    templateId: 'information-request.v1',
    templateVersion: '1',
    title: c.name,
    ...(c.typeNameTh ? { subtitle: c.typeNameTh } : {}),
    operationalState,
    sourceLabel: 'GenesisBlock Catalog Graph v4',
    asOf: c.priceExportDate ?? new Date().toISOString(),
    ...(kpis.length ? { kpis } : {}),
    ...(items.length ? { items } : {}),
    ...(c.reviewNote ? { riskFlags: [c.reviewNote] } : {}),
    ctaButtons: [{ label: 'ดูตัวเลือก', uri: `${MODEL_CARD_CTA_BASE}/v4/${encodeURIComponent(c.id)}`, type: 'uri' }],
  };
}

/**
 * Preview-only LINE Flex bubble for one `CardPayload` (AC-D7). "Preview-only" because the live DM
 * answer path never calls this: it sends the deterministic text from `format-cards.ts`'s
 * `cardsToText`, not a Flex card — this exists for a human previewing what a card *would* look
 * like, and the card content is validated by `src/cards/validator.ts` before it is built, exactly
 * as every other card this codebase sends is.
 */
export function modelCard(c: CardPayload): Record<string, unknown> {
  const viewModel = toCardViewModel(c);
  const validation = validateCardViewModel(viewModel);
  if (!validation.valid) {
    throw new Error(`modelCard: invalid card for ${c.id}: ${validation.errors.join('; ')}`);
  }

  const body: FlexComponent[] = [
    text('ซูริ CATALOG PREVIEW', { size: 'xs', weight: 'bold', color: ZURI.amberDark }),
    text(c.name, { size: 'lg', weight: 'bold', margin: 'md' }),
  ];
  if (c.typeNameTh) body.push(text(c.typeNameTh, { size: 'sm', color: '#6B6258', margin: 'sm' }));

  if (c.colors.length) {
    body.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      wrap: true,
      contents: c.colors.slice(0, 6).map((color) => ({
        type: 'text',
        text: color,
        size: 'xs',
        color: ZURI.blue,
        backgroundColor: ZURI.cream,
        align: 'center',
        margin: 'sm',
      })),
    });
  }

  if (c.selectedPrice) {
    const tierLabel = c.selectedPrice.qtyTier !== null ? `${c.selectedPrice.qtyTier} ชุด` : 'ราคาเริ่มต้น';
    body.push(text(`${c.selectedPrice.unitPrice} บาท / ชุด (${tierLabel})`, { size: 'md', weight: 'bold', margin: 'md', color: ZURI.amberDark }));
  } else if (c.priceNote) {
    body.push(text(c.priceNote, { size: 'sm', margin: 'md' }));
  } else {
    // No invented price: the same "never guess a number" rule the persona and the number check
    // in llm.ts enforce for chat text applies to a preview card too.
    body.push(text('ยังไม่มีข้อมูลราคาค่ะ', { size: 'sm', color: '#6B6258', margin: 'md' }));
  }

  if (c.reviewNote) body.push(text(c.reviewNote, { size: 'xs', color: '#B3261E', margin: 'md' }));

  // The rendered "ดูตัวเลือก" button is a LINE `postback` (`data: v4:<id>`), not the `uri` CTA
  // `toCardViewModel` carries for `src/cards/validator.ts`'s governance check — `CardCtaAction` in
  // `src/zuri-api/types.ts` only models `{ type: 'uri' }`, so that shared shape stays a validation
  // stand-in and is never what actually reaches the LINE bubble.
  return {
    type: 'bubble',
    size: 'mega',
    ...(c.image
      ? { hero: { type: 'image', url: c.image, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } }
      : {}),
    body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: body },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [{ type: 'button', style: 'primary', color: ZURI.amber, height: 'sm', action: { type: 'postback', label: 'ดูตัวเลือก', data: `v4:${c.id}` } }],
    },
  };
}
