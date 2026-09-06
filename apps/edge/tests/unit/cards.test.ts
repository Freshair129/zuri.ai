import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildExecutiveSummaryCard,
  buildChannelPerformanceCard,
  buildCampaignBreakdownCard,
  buildApprovalQueueCard,
  buildInformationRequestCard,
  validateCardViewModel,
  buildCardForTemplate,
} from '../../src/cards/index.ts';
import { VALID_EXECUTIVE_CARD_FIXTURE, INVALID_CTA_CARD_FIXTURE } from '../fixtures/cards.fixture.js';

// @tested FR-007 — the four supported card templates and their validator.
// @tested SDD-006 — the four CardViewModel builders and their validator.

describe('CardViewModel Builders and Validator (S4)', () => {
  it('builds executive summary card and validates successfully', () => {
    const card = buildExecutiveSummaryCard([
      { total_revenue: '฿245,800', total_orders: 1240, active_customers: 890, growth_rate: '+12.5%', risk_flag: 'none' },
    ]);

    assert.strictEqual(card.templateId, 'executive-summary.v1');
    assert.strictEqual(card.title, 'สรุปภาพรวมผู้บริหาร');
    assert.strictEqual(card.operationalState, 'live');

    const val = validateCardViewModel(card);
    assert.strictEqual(val.valid, true);
    assert.strictEqual(val.errors.length, 0);
  });

  it('builds channel performance card and validates successfully', () => {
    const card = buildChannelPerformanceCard([
      { channel_name: 'LINE OA', revenue: '฿125,000', conversions: 650, roi_ratio: '4.2x', status: 'live' },
    ]);

    assert.strictEqual(card.templateId, 'channel-performance.v1');
    assert.strictEqual(card.items?.length, 1);

    const val = validateCardViewModel(card);
    assert.strictEqual(val.valid, true);
  });

  it('builds campaign breakdown card and validates successfully', () => {
    const card = buildCampaignBreakdownCard([
      { campaign_name: 'Mother Day', category: 'Gifts', spend: '฿10,000', revenue: '฿50,000', conversions: 100 },
    ]);

    assert.strictEqual(card.templateId, 'campaign-breakdown.v1');
    const val = validateCardViewModel(card);
    assert.strictEqual(val.valid, true);
  });

  it('builds approval queue card and validates successfully', () => {
    const card = buildApprovalQueueCard([
      { action_id: 'act_01', action_type: 'Discount Approval', urgency: 'HIGH', status: 'PENDING' },
    ]);

    assert.strictEqual(card.templateId, 'actions-approval-queue.v1');
    const val = validateCardViewModel(card);
    assert.strictEqual(val.valid, true);
  });

  it('builds the bounded forecast information-request card as a snapshot', () => {
    const card = buildInformationRequestCard([]);
    assert.strictEqual(card.templateId, 'information-request.v1');
    assert.strictEqual(card.operationalState, 'snapshot');
    assert.ok(card.items?.some((item) => item.badge === 'MISSING'));
    assert.strictEqual(validateCardViewModel(card).valid, true);
  });

  it('validates card fixture and rejects illegal CTA domain', () => {
    const validRes = validateCardViewModel(VALID_EXECUTIVE_CARD_FIXTURE);
    assert.strictEqual(validRes.valid, true);

    const invalidRes = validateCardViewModel(INVALID_CTA_CARD_FIXTURE);
    assert.strictEqual(invalidRes.valid, false);
    assert.ok(invalidRes.errors.some((e) => e.includes('CTA URI disallowed')));
  });

  it('dispatches buildCardForTemplate dynamically for all approved templates', () => {
    const card1 = buildCardForTemplate('executive-summary.v1', [{}]);
    assert.strictEqual(card1.templateId, 'executive-summary.v1');

    const card2 = buildCardForTemplate('channel-performance.v1', [{}]);
    assert.strictEqual(card2.templateId, 'channel-performance.v1');

    const card3 = buildCardForTemplate('campaign-breakdown.v1', [{}]);
    assert.strictEqual(card3.templateId, 'campaign-breakdown.v1');

    const card4 = buildCardForTemplate('actions-approval-queue.v1', [{}]);
    assert.strictEqual(card4.templateId, 'actions-approval-queue.v1');

    const card5 = buildCardForTemplate('information-request.v1', []);
    assert.strictEqual(card5.templateId, 'information-request.v1');
  });
});
