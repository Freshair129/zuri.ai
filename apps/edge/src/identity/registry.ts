import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// @req SDD-009 — the identity register: a deny-by-default 1:1 chat register with role-based scoping.

/**
 * Who is allowed to talk to Zuri in a 1:1 chat, and what they may be told.
 *
 * A group has one alias and one allowlist. A direct message arrives from an arbitrary LINE user —
 * anyone who adds the official account as a friend can send one — so the answer has to start from
 * "no" and be widened deliberately, never the other way round.
 *
 * Identity comes from `source.userId` on a signature-verified webhook and from nowhere else. A
 * name typed into a message is a claim, not an identity: anyone can write "ผมพี่เจี๊ยบ".
 *
 * The raw LINE user id is never written down. It is keyed-hashed on the way in, exactly as the
 * message archive does, so the register cannot be turned back into a list of LINE accounts.
 */

export const ROLES = ['owner', 'sales'] as const;
export type Role = (typeof ROLES)[number];

export type IdentityStatus = 'pending' | 'approved' | 'revoked';

export interface Identity {
  userIdHash: string;
  /** LINE display name, kept only so a person can tell who they are approving. */
  displayName: string;
  status: IdentityStatus;
  role?: Role;
  /** Who this maps to inside the company. Set at approval. */
  email?: string;
  firstSeenAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface RegistryOptions {
  /** Directory the register lives in. */
  root: string;
  /** Same keyed-hash secret the message archive uses. */
  hashKey: string;
}

export function hashUserId(userId: string, hashKey: string): string {
  if (!hashKey) throw new Error('A hash key is required before any LINE identity can be stored.');
  return crypto.createHmac('sha256', hashKey).update(userId).digest('hex').slice(0, 32);
}

function registryPath(root: string): string {
  return path.join(root, 'identities.json');
}

function readAll(root: string): Identity[] {
  const file = registryPath(root);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as Identity[]) : [];
  } catch {
    // A corrupt register must not silently become an empty one — that would read as "nobody is
    // approved" and lock everyone out, or worse, be rewritten and lose the approvals.
    throw new Error(`Identity register at ${file} is unreadable. Fix or remove it deliberately.`);
  }
}

function writeAll(root: string, list: Identity[]): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(registryPath(root), JSON.stringify(list, null, 2), 'utf8');
}

export function listIdentities(options: RegistryOptions): Identity[] {
  return readAll(options.root);
}

/**
 * Look up a caller. Returns null for anyone not approved — pending and revoked included, so a
 * revoked account cannot keep asking and a pending one learns nothing while it waits.
 */
export function resolveIdentity(userId: string, options: RegistryOptions): Identity | null {
  const hash = hashUserId(userId, options.hashKey);
  const found = readAll(options.root).find((i) => i.userIdHash === hash);
  return found && found.status === 'approved' ? found : null;
}

/**
 * Record that someone asked for access. Idempotent: repeated messages from the same person do not
 * pile up requests, and an already-approved or revoked caller is left exactly as they are.
 */
export function requestAccess(
  userId: string,
  displayName: string,
  options: RegistryOptions,
  now: Date = new Date()
): Identity {
  const hash = hashUserId(userId, options.hashKey);
  const list = readAll(options.root);
  const existing = list.find((i) => i.userIdHash === hash);
  if (existing) {
    if (existing.status === 'pending' && displayName && existing.displayName !== displayName) {
      existing.displayName = displayName;
      writeAll(options.root, list);
    }
    return existing;
  }

  const entry: Identity = {
    userIdHash: hash,
    displayName: displayName || '(ไม่ทราบชื่อ)',
    status: 'pending',
    firstSeenAt: now.toISOString(),
  };
  list.push(entry);
  writeAll(options.root, list);
  return entry;
}

export function approve(
  userIdHash: string,
  role: Role,
  email: string,
  decidedBy: string,
  options: RegistryOptions,
  now: Date = new Date()
): Identity {
  const list = readAll(options.root);
  const entry = list.find((i) => i.userIdHash === userIdHash);
  if (!entry) throw new Error(`No identity with hash ${userIdHash} has ever asked for access.`);
  entry.status = 'approved';
  entry.role = role;
  entry.email = email;
  entry.decidedAt = now.toISOString();
  entry.decidedBy = decidedBy;
  writeAll(options.root, list);
  return entry;
}

export function revoke(
  userIdHash: string,
  decidedBy: string,
  options: RegistryOptions,
  now: Date = new Date()
): Identity {
  const list = readAll(options.root);
  const entry = list.find((i) => i.userIdHash === userIdHash);
  if (!entry) throw new Error(`No identity with hash ${userIdHash} is on the register.`);
  entry.status = 'revoked';
  entry.decidedAt = now.toISOString();
  entry.decidedBy = decidedBy;
  writeAll(options.root, list);
  return entry;
}
