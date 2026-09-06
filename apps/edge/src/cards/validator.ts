import { CardViewModel } from '../zuri-api/types.js';
import { isCtaUriAllowed } from './types.js';

export const APPROVED_TEMPLATES = [
  'executive-summary.v1',
  'channel-performance.v1',
  'campaign-breakdown.v1',
  'actions-approval-queue.v1',
  'information-request.v1',
];

export const VALID_OPERATIONAL_STATES = ['live', 'snapshot', 'candidate', 'unavailable'];

export interface CardValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateCardViewModel(card: CardViewModel): CardValidationResult {
  const errors: string[] = [];

  if (!APPROVED_TEMPLATES.includes(card.templateId)) {
    errors.push(`Disallowed templateId: ${card.templateId}`);
  }

  if (!VALID_OPERATIONAL_STATES.includes(card.operationalState)) {
    errors.push(`Invalid operationalState: ${card.operationalState}`);
  }

  if (!card.title || card.title.trim().length === 0) {
    errors.push('Card title is required');
  }

  if (!card.sourceLabel) {
    errors.push('sourceLabel is required');
  }

  if (!card.asOf || isNaN(Date.parse(card.asOf))) {
    errors.push('Valid asOf ISO timestamp is required');
  }

  if (!card.ctaButtons || card.ctaButtons.length === 0) {
    errors.push('At least one primary CTA button is required');
  } else {
    for (const button of card.ctaButtons) {
      if (!isCtaUriAllowed(button.uri)) {
        errors.push(`CTA URI disallowed by security policy: ${button.uri}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
