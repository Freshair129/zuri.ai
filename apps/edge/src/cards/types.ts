import { CardViewModel } from '../zuri-api/types.js';

export const ALLOWED_CTA_DOMAINS = [
  'https://zuri.app',
  'https://smartgift.co.th',
  'https://app.smartgift.co.th',
  'https://docs.google.com',
];

export function isCtaUriAllowed(uri: string): boolean {
  try {
    const url = new URL(uri);
    return ALLOWED_CTA_DOMAINS.some((allowed) => uri.startsWith(allowed));
  } catch {
    return false;
  }
}

export interface CardBuilderContext {
  operationalState?: 'live' | 'snapshot' | 'candidate' | 'unavailable';
  asOf?: string;
  sourceLabel?: string;
  /** Caller-supplied headline copy. A builder keeps its own default when these are absent. */
  title?: string;
  subtitle?: string;
  riskFlags?: string[];
  /** Still filtered by `isCtaUriAllowed` in the validator; overriding never widens the allow-list. */
  ctaButtons?: CardViewModel['ctaButtons'];
}

export type CardBuilderFunction = (
  data: Record<string, unknown>[],
  ctx?: CardBuilderContext
) => CardViewModel;
