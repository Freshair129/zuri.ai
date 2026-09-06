import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isRawLineId } from '../safety/redact.js';
import { ArchiveResult, ArchivedLineEvent, ArchivedOutboundMessage } from './types.js';

// @req BR-010 — an outbound message is archived beside the inbound ones it answers.

interface LineWebhookEvent {
  webhookEventId?: string;
  timestamp?: number;
  type?: string;
  source?: { type?: string; groupId?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string };
}

interface DedupeRecord { expiresAt: string }

export interface LineHistoryArchiveOptions {
  root: string;
  groupAliases: Record<string, string>;
  allowedGroupAliases: string[];
  hashKey: string;
  retentionDays: number;
  /** Retention for direct conversations. Defaults to `retentionDays` when unset. */
  dmRetentionDays?: number;
  receivedAt?: Date;
  correlationId?: string;
}

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined, channelSecret: string): boolean {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export function archiveLineWebhookPayload(
  payload: { events?: LineWebhookEvent[] },
  options: LineHistoryArchiveOptions
): ArchiveResult {
  const receivedAt = options.receivedAt || new Date();
  const root = path.resolve(options.root);
  fs.mkdirSync(root, { recursive: true });
  const dedupePath = path.join(root, '.dedupe.json');
  const dedupe = readDedupe(dedupePath, receivedAt);
  const files = new Set<string>();
  let archived = 0;
  let duplicate = 0;
  let ignored = 0;

  for (const event of payload.events || []) {
    const groupAlias = resolveAllowedGroupAlias(event.source?.groupId, options);
    const eventId = event.webhookEventId;
    // A direct message has no owner-configured alias, so it is filed under the sender's own hash.
    // It is still a message this runtime received, and leaving it out was the reason a DM appeared
    // in no record at all — neither the question nor the answer.
    const directSender = !event.source?.groupId ? event.source?.userId : undefined;
    if ((!groupAlias && !directSender) || !eventId) {
      ignored++;
      continue;
    }
    if (dedupe[eventId]) {
      duplicate++;
      continue;
    }

    const occurredAt = new Date(event.timestamp || receivedAt.getTime());
    const conversationHash = directSender
      ? conversationDirectory(keyedHash(directSender, options.hashKey))
      : undefined;
    const record: ArchivedLineEvent = {
      schemaVersion: 1,
      webhookEventId: eventId,
      occurredAt: occurredAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      scope: groupAlias ? 'group' : 'dm',
      ...(groupAlias ? { groupAlias } : {}),
      ...(conversationHash ? { conversationHash } : {}),
      senderHash: keyedHash(event.source?.userId || 'unknown', options.hashKey),
      eventType: event.type || 'unknown',
      ...(event.message?.type ? { messageType: event.message.type } : {}),
      ...(event.message?.type === 'text' && event.message.text ? { text: event.message.text } : {}),
      ...(event.message?.id ? { messageIdHash: keyedHash(event.message.id, options.hashKey) } : {}),
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    };
    const archivePath = groupAlias
      ? weeklyArchivePath(root, groupAlias, occurredAt)
      : directArchivePath(root, conversationHash!, occurredAt);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.appendFileSync(archivePath, `${JSON.stringify(record)}\n`, 'utf8');
    files.add(archivePath);
    dedupe[eventId] = { expiresAt: new Date(receivedAt.getTime() + options.retentionDays * 86_400_000).toISOString() };
    archived++;
  }

  fs.writeFileSync(dedupePath, JSON.stringify(dedupe, null, 2), 'utf8');
  return {
    archived,
    duplicate,
    ignored,
    files: [...files].sort(),
    pruned: pruneExpiredArchives(root, receivedAt, options.retentionDays, options.dmRetentionDays),
  };
}

export interface OutboundArchiveInput {
  /** The LINE destination: a group id for a group reply or an operator-initiated push. */
  recipientId: string;
  text: string;
  deliveryKind: 'reply' | 'push';
  messageType?: 'text' | 'flex';
  inReplyToEventId?: string;
  correlationId?: string;
  sentAt?: Date;
}

/**
 * Record a message this runtime sent.
 *
 * Same allow-list as the inbound side: a destination the owner has not configured as an alias is
 * not archived, because the archive is organised by alias and there is nowhere honest to file it.
 * That mirrors `archiveLineWebhookPayload`, which ignores events from groups it does not know.
 *
 * Deliberately not deduplicated. The caller records after a delivery LINE has accepted, so a second
 * record would mean a second delivery — which is a thing an archive should show, not hide.
 */
export function archiveOutboundLineMessage(
  input: OutboundArchiveInput,
  options: LineHistoryArchiveOptions
): { archived: boolean; file?: string } {
  const groupAlias = resolveAllowedGroupAlias(input.recipientId, options);
  /*
   * What kind of destination this is, decided by the id's own shape rather than by whether anyone
   * configured it — the same rule `resolvePushTarget` uses to decide who a push may reach, so the
   * archive and the send guard cannot disagree about what a user is.
   *
   * Deciding by configuration instead would have filed an unconfigured group id under a
   * conversation hash, as though a group were a person. That is precisely the destination the
   * allow-list exists to exclude, and archiving it under any name would say the send was expected.
   */
  const isUser =
    isRawLineId(input.recipientId) && input.recipientId.trim().toLowerCase().startsWith('u');
  if (!groupAlias && !isUser) return { archived: false };

  const recipientHash = keyedHash(input.recipientId, options.hashKey);
  const conversationHash = groupAlias ? undefined : conversationDirectory(recipientHash);
  const sentAt = input.sentAt || options.receivedAt || new Date();
  const record: ArchivedOutboundMessage = {
    schemaVersion: 1,
    direction: 'outbound',
    outboundId: crypto.randomUUID(),
    occurredAt: sentAt.toISOString(),
    scope: groupAlias ? 'group' : 'dm',
    ...(groupAlias ? { groupAlias } : {}),
    ...(conversationHash ? { conversationHash } : {}),
    recipientHash,
    deliveryKind: input.deliveryKind,
    messageType: input.messageType || 'text',
    ...(input.text ? { text: input.text } : {}),
    ...(input.inReplyToEventId ? { inReplyToEventId: input.inReplyToEventId } : {}),
    ...(options.correlationId || input.correlationId
      ? { correlationId: input.correlationId || options.correlationId }
      : {}),
  };

  const root = path.resolve(options.root);
  const archivePath = groupAlias
    ? weeklyArchivePath(root, groupAlias, sentAt)
    : directArchivePath(root, conversationHash!, sentAt);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.appendFileSync(archivePath, `${JSON.stringify(record)}\n`, 'utf8');
  return { archived: true, file: archivePath };
}

export function weeklyArchivePath(root: string, groupAlias: string, occurredAt: Date): string {
  const { year, week } = isoWeek(occurredAt);
  return path.join(root, safeAlias(groupAlias), `${year}-W${String(week).padStart(2, '0')}.jsonl`);
}

/** Where direct messages live, kept apart from the alias directories by a name an alias cannot take. */
export const DIRECT_MESSAGE_DIR = '_dm';

/**
 * The directory name for one direct conversation.
 *
 * The leading 16 hex of the keyed sender hash: long enough that two conversations will not collide,
 * short enough to read in a directory listing, and derived rather than stored — the raw LINE id
 * never reaches the disk. Both halves of a conversation resolve to the same name, because the
 * sender of the question and the recipient of the answer are the same person.
 */
export function conversationDirectory(keyedSenderHash: string): string {
  const hex = keyedSenderHash.replace(/^hmac-sha256:/, '');
  if (!/^[a-f0-9]{32,}$/.test(hex)) throw new Error('Unexpected conversation hash.');
  return hex.slice(0, 16);
}

export function directArchivePath(root: string, conversationHash: string, occurredAt: Date): string {
  if (!/^[a-f0-9]{16}$/.test(conversationHash)) throw new Error('Unsafe conversation hash.');
  const { year, week } = isoWeek(occurredAt);
  return path.join(root, DIRECT_MESSAGE_DIR, conversationHash, `${year}-W${String(week).padStart(2, '0')}.jsonl`);
}

/**
 * Delete archive weeks past their retention.
 *
 * Two clocks, because a private conversation and a group history are not the same thing to keep.
 * `dmRetentionDays` falls back to `retentionDays`, so a caller that has no opinion gets the old
 * single-clock behaviour rather than an accidental change.
 */
export function pruneExpiredArchives(
  root: string,
  now: Date,
  retentionDays: number,
  dmRetentionDays: number = retentionDays
): string[] {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return [];
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const dmCutoff = now.getTime() - dmRetentionDays * 86_400_000;
  const deleted: string[] = [];
  // Group weeks sit one level down (`<alias>/<week>.jsonl`); direct conversations sit two
  // (`_dm/<hash>/<week>.jsonl`). Retention that reached only the first depth would have kept every
  // direct message forever — the opposite of what a retention policy is for, and on the content
  // most worth expiring.
  const sweepWeeks = (directory: string, expiresBefore: number): void => {
    for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/^\d{4}-W\d{2}\.jsonl$/.test(file.name)) continue;
      const target = path.resolve(directory, file.name);
      if (fs.statSync(target).mtimeMs < expiresBefore) {
        fs.unlinkSync(target);
        deleted.push(target);
      }
    }
  };

  for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.resolve(resolvedRoot, entry.name);
    if (!directory.startsWith(`${resolvedRoot}${path.sep}`)) continue;

    if (entry.name === DIRECT_MESSAGE_DIR) {
      for (const conversation of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!conversation.isDirectory() || !/^[a-f0-9]{16}$/.test(conversation.name)) continue;
        const conversationDir = path.resolve(directory, conversation.name);
        if (!conversationDir.startsWith(`${directory}${path.sep}`)) continue;
        sweepWeeks(conversationDir, dmCutoff);
        // A conversation whose last week has expired leaves an empty directory behind, which is a
        // hash sitting on disk saying someone once wrote in. Remove it with its contents.
        if (fs.readdirSync(conversationDir).length === 0) fs.rmdirSync(conversationDir);
      }
      continue;
    }

    sweepWeeks(directory, cutoff);
  }
  return deleted.sort();
}

function resolveAllowedGroupAlias(groupId: string | undefined, options: LineHistoryArchiveOptions): string | null {
  if (!groupId) return null;
  const match = Object.entries(options.groupAliases).find(([, configuredId]) => configuredId === groupId)?.[0];
  return match && options.allowedGroupAliases.includes(match) ? match : null;
}

function readDedupe(file: string, now: Date): Record<string, DedupeRecord> {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, DedupeRecord>;
    return Object.fromEntries(Object.entries(all).filter(([, value]) => Date.parse(value.expiresAt) > now.getTime()));
  } catch {
    return {};
  }
}

function keyedHash(value: string, key: string): string {
  return `hmac-sha256:${crypto.createHmac('sha256', key).update(value).digest('hex')}`;
}

function safeAlias(value: string): string {
  if (!/^[a-z0-9-]+$/i.test(value)) throw new Error('Unsafe group alias.');
  return value.toLowerCase();
}

function isoWeek(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  return { year, week: Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7) };
}
