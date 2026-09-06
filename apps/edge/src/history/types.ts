export interface ArchivedLineEvent {
  schemaVersion: 1;
  webhookEventId: string;
  occurredAt: string;
  receivedAt: string;
  /**
   * Which conversation this belongs to. Absent on every record written before direct messages were
   * archived, and those are all group records — so absent means `'group'`, and `groupAlias` is the
   * field to read.
   */
  scope?: 'group' | 'dm';
  /** Present for a group conversation. */
  groupAlias?: string;
  /**
   * Present for a direct message: the leading hex of the keyed sender hash, which is also the
   * directory the record is filed under. A direct message has no owner-configured alias, and the
   * raw LINE id is never written to disk, so the hash is the only stable name it has.
   */
  conversationHash?: string;
  senderHash: string;
  eventType: string;
  messageType?: string;
  text?: string;
  messageIdHash?: string;
  correlationId?: string;
}

/**
 * A message this runtime sent, recorded in the same file as the ones it received.
 *
 * An archive holding only the inbound half can show what a customer asked and not what the OA
 * answered, which is the half that matters when someone disputes what was said. `direction` is what
 * separates the two: a record without it is inbound, because every record written before this
 * existed is inbound.
 */
export interface ArchivedOutboundMessage {
  schemaVersion: 1;
  direction: 'outbound';
  outboundId: string;
  /** When LINE accepted the send, so inbound and outbound sort into one timeline. */
  occurredAt: string;
  scope: 'group' | 'dm';
  /** Present for a group conversation. */
  groupAlias?: string;
  /** Present for a direct message — see `ArchivedLineEvent.conversationHash`. */
  conversationHash?: string;
  /** The destination, hashed with the same key as `senderHash`, so neither side stores a raw id. */
  recipientHash: string;
  deliveryKind: 'reply' | 'push';
  messageType: 'text' | 'flex';
  text?: string;
  /** The inbound `webhookEventId` this answers. Absent for an operator-initiated push. */
  inReplyToEventId?: string;
  correlationId?: string;
}

export type ArchivedLineRecord = ArchivedLineEvent | ArchivedOutboundMessage;

export interface ArchiveResult {
  archived: number;
  duplicate: number;
  ignored: number;
  files: string[];
  pruned: string[];
}
