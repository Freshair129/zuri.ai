import {
  createPluginCommandEnvelope,
  PluginCommandEnvelope,
  PluginCommandInput,
} from './contract.js';

// @req ZPP-FR-003 — the transport-neutral boundary a harness adapter sits behind, so adapters differ in UI and never in command meaning.

export interface PluginTransportResponse {
  receiptId: string;
  status: string;
  traceId: string;
  [key: string]: unknown;
}

export interface PluginTransport {
  send(envelope: PluginCommandEnvelope): Promise<PluginTransportResponse>;
}

export type PluginPreviewInput = Omit<PluginCommandInput, 'commandType'>;

/**
 * Transport-neutral SDK boundary for harness adapters.
 *
 * This class intentionally has no fetch, database, secret, or policy authority. A later phase
 * may provide a Zuri-approved transport implementation; P1 can exercise the contract with a
 * memory-only transport.
 */
export class ZuriPluginSdk {
  constructor(private readonly transport: PluginTransport) {}

  buildEnvelope(input: PluginCommandInput): PluginCommandEnvelope {
    return createPluginCommandEnvelope(input);
  }

  preview(input: PluginPreviewInput): Promise<PluginTransportResponse> {
    const envelope = this.buildEnvelope({
      ...input,
      commandType: 'PLAN_PREVIEW',
    });
    return this.transport.send(envelope);
  }
}
