/**
 * Types for canonical zuri-command-agent-api-v1 contract.
 */

export type ContractVersion = '0.1.0b';

export type CommandSource = 'codex' | 'claude_code' | 'antigravity' | 'line';

export type DeliveryIntent = 'preview' | 'line_reply' | 'line_push';

export type CommandLifecycle =
  | 'ADMITTED'
  | 'QUEUED'
  | 'CLAIMED'
  | 'EVIDENCE_READY'
  | 'REVIEW_REQUIRED'
  | 'DELIVERY_PENDING'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export type SensitivityClass = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export type OperationalState = 'live' | 'snapshot' | 'candidate' | 'unavailable';

export interface CommandEnvelope {
  contractVersion: ContractVersion;
  source: CommandSource;
  tenantRef?: string;
  groupRef?: string;
  command: 'executive_summary' | 'channel_performance' | 'campaign_breakdown' | 'approval_queue';
  arguments: Record<string, unknown>;
  delivery: DeliveryIntent;
  idempotencyKey: string;
}

export interface CommandJob {
  commandId: string;
  tenantId: string;
  policySnapshotId: string;
  contractVersion: ContractVersion;
  source: CommandSource;
  command: string;
  arguments: Record<string, unknown>;
  deliveryIntent: DeliveryIntent;
  lifecycle: CommandLifecycle;
  idempotencyKey: string;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lease {
  leaseId: string;
  commandId: string;
  tenantId: string;
  deviceId: string;
  expiresAt: string;
  queryId: string;
  queryVersion: string;
}

export interface CardCtaAction {
  label: string;
  uri: string;
  type: 'uri';
}

export interface CardViewModel {
  templateId: string;
  templateVersion: string;
  title: string;
  subtitle?: string;
  operationalState: OperationalState;
  sourceLabel: string;
  asOf: string;
  kpis?: Array<{
    label: string;
    value: string;
    delta?: string;
    status?: 'positive' | 'negative' | 'neutral' | 'warning';
  }>;
  items?: Array<{
    title: string;
    value?: string;
    subtitle?: string;
    badge?: string;
  }>;
  riskFlags?: string[];
  ctaButtons: CardCtaAction[];
}

export interface EvidencePacket {
  contractVersion: ContractVersion;
  commandId: string;
  tenantId: string;
  policySnapshotId: string;
  queryId: string;
  queryVersion: string;
  source: string;
  asOf: string;
  sensitivity: SensitivityClass;
  data: Record<string, unknown>;
  cardViewModel: CardViewModel;
}

export interface HeartbeatPayload {
  contractVersion: ContractVersion;
  deviceId: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  registeredQueries: string[];
  approvedTemplates: string[];
  timestamp: string;
}

export interface ReleasePayload {
  commandId: string;
  leaseId: string;
  reasonCode: string;
  message: string;
}
