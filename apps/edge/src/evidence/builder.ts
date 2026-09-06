import { EvidencePacket, CardViewModel, SensitivityClass } from '../zuri-api/types.js';

// @req SDD-005 — the evidence builder: normalized aggregate facts with source, as_of and sensitivity.
// @req AC-005 — returned evidence carries source, as_of, query version and sensitivity — never raw SQL or unbounded rows.
// @req NFR-005 — the traceability tuple: command id, policy snapshot id, query version, template version, source and as_of travel with every result.

export interface BuildEvidenceInput {
  commandId: string;
  tenantId: string;
  policySnapshotId: string;
  queryId: string;
  queryVersion: string;
  source: string;
  asOf: string;
  sensitivity: SensitivityClass;
  rawQueryResult: Record<string, unknown>[];
  cardViewModel: CardViewModel;
}

export function buildEvidencePacket(input: BuildEvidenceInput): EvidencePacket {
  return {
    contractVersion: '0.1.0b',
    commandId: input.commandId,
    tenantId: input.tenantId,
    policySnapshotId: input.policySnapshotId,
    queryId: input.queryId,
    queryVersion: input.queryVersion,
    source: input.source,
    asOf: input.asOf,
    sensitivity: input.sensitivity,
    data: {
      rows: input.rawQueryResult,
      rowCount: input.rawQueryResult.length,
    },
    cardViewModel: input.cardViewModel,
  };
}
