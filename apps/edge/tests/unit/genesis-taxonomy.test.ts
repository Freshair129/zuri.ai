import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTaxonomyName,
  normalizeTaxonomyText,
} from '../../src/rag/taxonomy.js';

// @tested TAX-FR-001 — the controlled vocabulary and its aliases.
// @tested TAX-FR-002 — parsing into reproducible components.
// @tested TAX-FR-003 — family assignment and the unclassified bucket.
// @tested TAX-NFR-001 — a repeat run classifies identically.

describe('Genesis taxonomy parser', () => {
  it('normalizes Unicode, case, whitespace, and plus separators deterministically', () => {
    assert.equal(
      normalizeTaxonomyText('  Key chain+USB  '),
      'key chain + usb'
    );
  });

  it('classifies a simple drinkware name as one base category', () => {
    const result = classifyTaxonomyName('Coffee Mug');

    assert.equal(result.status, 'auto');
    assert.deepEqual(result.categoryIds, ['drinkware']);
    assert.equal(result.componentSignature, 'drinkware');
    assert.equal(result.components[0]?.matchedAlias, 'coffee mug');
  });

  it('classifies explicit bundle components and preserves a sorted signature', () => {
    const result = classifyTaxonomyName('Flask + A5 Notebook + USB + Pen');

    assert.equal(result.status, 'auto');
    assert.deepEqual(result.categoryIds, [
      'drinkware',
      'notebook',
      'pen',
      'usb_flash_drive',
    ]);
    assert.equal(
      result.componentSignature,
      'drinkware+notebook+pen+usb_flash_drive'
    );
  });

  it('removes packaging wording from components while retaining metadata evidence', () => {
    const result = classifyTaxonomyName(
      'Vacuum Cup + Umbrella Gift Set with Drawer Box Packing'
    );

    assert.equal(result.status, 'auto');
    assert.deepEqual(result.categoryIds, ['drinkware', 'umbrella']);
    assert.deepEqual(result.metadata.packagingPhrases, [
      'gift set',
      'drawer box packing',
    ]);
  });

  it('does not misclassify World Cup as drinkware and sends the series prefix to review', () => {
    const result = classifyTaxonomyName(
      'World Cup Series: Power bank + Fan'
    );

    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.categoryIds, ['fan', 'power_bank']);
    assert.equal(result.categoryIds.includes('drinkware'), false);
    assert.ok(result.reviewReasons.includes('series_prefix'));
  });

  it('marks ambiguous separators for review while retaining explicit components', () => {
    const result = classifyTaxonomyName(
      'G shape wireless charger & speaker'
    );

    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.categoryIds, ['charger', 'speaker']);
    assert.ok(result.reviewReasons.includes('ampersand_separator'));
  });

  it('preserves repeated components in the signature and requires review', () => {
    const result = classifyTaxonomyName(
      'Notebook + cloud shape bookmark + bookmark with tassel + refill + pen + usb flash drive'
    );

    assert.equal(result.status, 'review_required');
    assert.equal(
      result.componentSignature,
      'bookmark+bookmark+notebook+notebook_refill+pen+usb_flash_drive'
    );
    assert.ok(result.reviewReasons.includes('duplicate_component'));
  });

  it('ignores descriptive text after a middle dot when the primary phrase is complete', () => {
    const result = classifyTaxonomyName(
      'A5 notebook + pen · Notebook A5 Pen Plastic, rollerball, 0.5 refill, black'
    );

    assert.equal(result.status, 'auto');
    assert.deepEqual(result.categoryIds, ['notebook', 'pen']);
    assert.equal(result.metadata.descriptiveSuffixPresent, true);
  });

  it('does not treat gift bag packaging as a bag component', () => {
    const result = classifyTaxonomyName(
      'Umbrella in simple gift bag packing'
    );

    assert.equal(result.status, 'auto');
    assert.deepEqual(result.categoryIds, ['umbrella']);
    assert.equal(result.categoryIds.includes('bag'), false);
  });

  it('keeps commercial and car phrase ambiguity visible for review', () => {
    const result = classifyTaxonomyName(
      'Car Wireless Charging Mount+Car parking Dual number plate+Keychain+Car Charger+gift box+gift bag(MOQ 100 SETS)'
    );

    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.categoryIds, [
      'car_accessory',
      'charger',
      'key_chain',
    ]);
    assert.ok(result.reviewReasons.includes('commercial_text'));
  });

  it('returns an explicit unclassified result for a blank name', () => {
    const result = classifyTaxonomyName('   ');

    assert.equal(result.status, 'unclassified');
    assert.deepEqual(result.categoryIds, []);
    assert.equal(result.componentSignature, null);
    assert.deepEqual(result.reviewReasons, ['missing_name']);
  });

  it('does not infer mouse from the unrelated mouse pad phrase', () => {
    const result = classifyTaxonomyName('Wireless mouse pad');

    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.categoryIds, []);
    assert.ok(result.reviewReasons.includes('unmatched_component'));
  });

  it('requires review when multiple components appear without an explicit separator', () => {
    const result = classifyTaxonomyName(
      'A5 metal plate plain notebook with pen'
    );

    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.categoryIds, ['notebook', 'pen']);
    assert.ok(result.reviewReasons.includes('implicit_separator'));
  });

  it('returns unknown names as unclassified and remains replay-deterministic', () => {
    const first = classifyTaxonomyName('Mystery promotional item');
    const second = classifyTaxonomyName('Mystery promotional item');

    assert.equal(first.status, 'unclassified');
    assert.ok(first.reviewReasons.includes('unmatched_component'));
    assert.deepEqual(second, first);
  });
});
