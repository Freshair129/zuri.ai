// Contract for the evidence packet — the only shape in which a local query result is allowed to
// leave this runtime.
//
// The packet is what makes a number auditable after the fact: which command asked, under which
// policy snapshot, from which query at which version, against which source, as of when, and at what
// sensitivity. A packet missing any of those is a figure with no way back to its origin, which is
// the failure the traceability rule exists to prevent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidencePacket, BuildEvidenceInput } from '../../src/evidence/builder.js';
import { VALID_EXECUTIVE_CARD_FIXTURE } from '../fixtures/cards.fixture.js';

// @tested SDD-005 — normalized aggregate facts carrying source, as_of and sensitivity.
// @tested AC-005 — evidence carries source, as_of, query version and sensitivity, and no raw SQL.
// @tested NFR-005 — the full traceability tuple travels with the result.

const input = (over: Partial<BuildEvidenceInput> = {}): BuildEvidenceInput => ({
  commandId: 'cmd_01',
  tenantId: 'tenant_01',
  policySnapshotId: 'pol_snap_v1',
  queryId: 'executive_summary.v1',
  queryVersion: '1.0.0',
  source: 'smartgift.duckdb',
  asOf: '2026-09-06T00:00:00.000Z',
  sensitivity: 'INTERNAL',
  rawQueryResult: [{ total_revenue: 1200, total_orders: 8 }],
  cardViewModel: VALID_EXECUTIVE_CARD_FIXTURE,
  ...over,
});

describe('evidence packet', () => {
  it('carries every field a result must be traceable by', () => {
    const packet = buildEvidencePacket(input());
    // NFR-005 names six: command id, policy snapshot id, query version, template version, source
    // and as_of. Five sit on the packet; templateVersion rides on the card it embeds.
    assert.strictEqual(packet.commandId, 'cmd_01');
    assert.strictEqual(packet.policySnapshotId, 'pol_snap_v1');
    assert.strictEqual(packet.queryVersion, '1.0.0');
    assert.strictEqual(packet.source, 'smartgift.duckdb');
    assert.strictEqual(packet.asOf, '2026-09-06T00:00:00.000Z');
    assert.ok(packet.cardViewModel.templateVersion, 'the card must name its template version');
  });

  it('states its sensitivity rather than leaving the reader to infer it', () => {
    assert.strictEqual(buildEvidencePacket(input()).sensitivity, 'INTERNAL');
    assert.strictEqual(
      buildEvidencePacket(input({ sensitivity: 'RESTRICTED' })).sensitivity,
      'RESTRICTED'
    );
  });

  it('pins the contract version, so a receiver can tell which shape it was handed', () => {
    assert.strictEqual(buildEvidencePacket(input()).contractVersion, '0.1.0b');
  });

  it('reports a row count that matches the rows, so a truncated packet cannot look complete', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const packet = buildEvidencePacket(input({ rawQueryResult: rows }));
    assert.strictEqual(packet.data.rowCount, 3);
    assert.strictEqual(packet.data.rows.length, packet.data.rowCount);
  });

  it('counts an empty result as zero rows rather than omitting the count', () => {
    const packet = buildEvidencePacket(input({ rawQueryResult: [] }));
    assert.strictEqual(packet.data.rowCount, 0);
    assert.deepStrictEqual(packet.data.rows, []);
  });

  // AC-005's second half: the packet is a carrier for evidence, not for the means of producing it.
  // If SQL text ever reached a packet, the query registry would have been bypassed on the way.
  it('has nowhere to put SQL text, and puts none there', () => {
    const packet = buildEvidencePacket(input());
    const serialized = JSON.stringify(packet);
    assert.ok(!/\bSELECT\b/i.test(serialized), 'a packet must never carry query text');
    assert.ok(!Object.keys(packet).some((k) => /sql/i.test(k)));
  });

  it('does not alias the caller\'s rows into the packet by reference alone', () => {
    const rows = [{ a: 1 }];
    const packet = buildEvidencePacket(input({ rawQueryResult: rows }));
    assert.deepStrictEqual(packet.data.rows, rows);
  });
});
