import crypto from 'crypto';
import { IZuriApiClient } from '../zuri-api/client.js';
import { CommandEnvelope, CommandJob, CommandSource } from '../zuri-api/types.js';
import { isRawLineId } from '../safety/redact.js';

// @req FR-003, AC-002 — `preview` creates one idempotent preview command and never calls the LINE
//   Messaging API.
// @req FR-004, AC-003 — `send --group <alias>` requests a governed delivery intent; Zuri decides
//   send versus review.
// @req FR-005, AC-007 — `status` returns a redacted lifecycle without credentials or PII.
// @req FR-008 — group targeting takes an owner-configured alias, never a raw LINE group id.
// @req FR-007 — `SUPPORTED_TEMPLATES` is the four supported card templates. `src/cards/` exports a
//   fifth builder, `information-request`, which is a separate POC path and deliberately not one of them.

/**
 * CLI-facing template ids (v1). Maps 1:1 to the contract's `CommandEnvelope.command` union —
 * see docs/appendices/A-api-spec.md §A.1.
 */
export const SUPPORTED_TEMPLATES = [
  'executive-summary',
  'channel-performance',
  'campaign-breakdown',
  'actions-approval-queue',
] as const;

export type SupportedTemplate = (typeof SUPPORTED_TEMPLATES)[number];

const TEMPLATE_TO_COMMAND: Record<SupportedTemplate, CommandEnvelope['command']> = {
  'executive-summary': 'executive_summary',
  'channel-performance': 'channel_performance',
  'campaign-breakdown': 'campaign_breakdown',
  'actions-approval-queue': 'approval_queue',
};

export function isSupportedTemplate(template: string): template is SupportedTemplate {
  return (SUPPORTED_TEMPLATES as readonly string[]).includes(template);
}

export function mapTemplateToCommand(template: string): CommandEnvelope['command'] {
  if (!isSupportedTemplate(template)) {
    throw new Error(
      `Unsupported template: "${template}". Supported templates: ${SUPPORTED_TEMPLATES.join(', ')}`
    );
  }
  return TEMPLATE_TO_COMMAND[template];
}

export interface PreviewOptions {
  source?: CommandSource;
  period?: string;
  limit?: number;
  idempotencyKey?: string;
}

export interface SendOptions extends PreviewOptions {
  group: string;
}

/**
 * `zuri-agent preview <template>` — creates one idempotent Zuri preview command.
 * Never calls the LINE Messaging API (FR-003, AC-002); the CLI only requests the command,
 * it does not deliver anything.
 */
export async function runPreview(
  client: IZuriApiClient,
  template: string,
  options: PreviewOptions = {}
): Promise<CommandJob> {
  const command = mapTemplateToCommand(template);
  const envelope: CommandEnvelope = {
    contractVersion: '0.1.0b',
    source: options.source || 'codex',
    command,
    arguments: buildArguments(options),
    delivery: 'preview',
    idempotencyKey: options.idempotencyKey || generateIdempotencyKey(),
  };
  return client.admitCommand(envelope);
}

/**
 * `zuri-agent send <template> --group <alias>` — requests a governed `line_push` delivery
 * intent. Zuri alone decides send vs. review from its policy snapshot (FR-004, AC-003); this
 * never accepts a raw LINE group ID as the authority field (FR-008).
 */
export async function runSend(
  client: IZuriApiClient,
  template: string,
  options: SendOptions
): Promise<CommandJob> {
  const group = (options.group ?? '').trim();
  if (!group) {
    throw new Error(
      'The --group <alias> flag is required for "send" and must be a non-empty, owner-configured group alias.'
    );
  }
  if (isRawLineId(group)) {
    throw new Error(
      `--group must be an owner-configured alias, not a raw LINE ID. Ask the Zuri owner for the ` +
        `approved alias for this group (see AGENTS.md permission matrix).`
    );
  }

  const command = mapTemplateToCommand(template);
  const envelope: CommandEnvelope = {
    contractVersion: '0.1.0b',
    source: options.source || 'codex',
    groupRef: group,
    command,
    arguments: buildArguments(options),
    delivery: 'line_push',
    idempotencyKey: options.idempotencyKey || generateIdempotencyKey(),
  };
  return client.admitCommand(envelope);
}

/**
 * `zuri-agent status <command-id>` — reads a redacted command lifecycle/result (FR-005, AC-007).
 * `CommandJob` carries no credentials, hidden group IDs, raw transcript, or PII, so it is safe
 * to return as-is.
 */
export async function runStatus(client: IZuriApiClient, commandId: string): Promise<CommandJob> {
  const id = (commandId ?? '').trim();
  if (!id) {
    throw new Error('A <command-id> argument is required.');
  }
  const job = await client.getCommandStatus(id);
  if (!job) {
    throw new Error(`No command found for id: ${id}`);
  }
  return job;
}

function buildArguments(options: PreviewOptions): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (options.period) args.period = options.period;
  if (options.limit !== undefined) args.limit = options.limit;
  return args;
}

function generateIdempotencyKey(): string {
  return `idem_${crypto.randomUUID()}`;
}
