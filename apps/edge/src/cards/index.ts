export * from './types.js';
export * from './validator.js';
export * from './builders/executive-summary.js';
export * from './builders/channel-performance.js';
export * from './builders/campaign-breakdown.js';
export * from './builders/approval-queue.js';
export * from './builders/information-request.js';

import { buildExecutiveSummaryCard } from './builders/executive-summary.js';
import { buildChannelPerformanceCard } from './builders/channel-performance.js';
import { buildCampaignBreakdownCard } from './builders/campaign-breakdown.js';
import { buildApprovalQueueCard } from './builders/approval-queue.js';
import { buildInformationRequestCard } from './builders/information-request.js';
import { CardBuilderContext } from './types.js';
import { CardViewModel } from '../zuri-api/types.js';

// @req SDD-006 — the card builders; no raw Flex JSON is delivered from here.

export function buildCardForTemplate(
  templateId: string,
  data: Record<string, unknown>[],
  ctx?: CardBuilderContext
): CardViewModel {
  switch (templateId) {
    case 'executive-summary.v1':
    case 'executive-summary':
      return buildExecutiveSummaryCard(data, ctx);
    case 'channel-performance.v1':
    case 'channel-performance':
      return buildChannelPerformanceCard(data, ctx);
    case 'campaign-breakdown.v1':
    case 'campaign-breakdown':
      return buildCampaignBreakdownCard(data, ctx);
    case 'actions-approval-queue.v1':
    case 'actions-approval-queue':
    case 'approval_queue':
      return buildApprovalQueueCard(data, ctx);
    case 'information-request.v1':
    case 'information-request':
    case 'information_request':
      return buildInformationRequestCard(data, ctx);
    default:
      throw new Error(`Unsupported templateId: ${templateId}`);
  }
}
