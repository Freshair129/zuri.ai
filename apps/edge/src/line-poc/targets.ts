import { isRawLineId } from '../safety/redact.js';

// @req FR-008 — group targeting resolves against an owner-configured alias; a raw group id from a
//   request body is refused rather than sent to.

/**
 * Deciding who a console-initiated push is allowed to reach.
 *
 * The command console takes a recipient from the request body and pushed it straight through,
 * reaching `pushTextTo(target, text, 'group')` by casting past `private` for anything that did not
 * look like a user id. That cast defeated the one guard on the direct path, so an arbitrary group
 * id in a request body was a message sent to that group as the OA — which made the claim in
 * `docs/LINE-REPLY-OWNERSHIP-DECISION.md` that "a send cannot reach an unintended recipient" false
 * as written.
 *
 * The rule that restores it: a group is reachable only if the owner has already configured it as an
 * alias. Anything else is refused rather than attempted. A user is still reachable by id, because
 * that id came out of a signature-verified webhook event rather than from whoever is asking.
 */

export type PushTarget =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string; alias: string };

/**
 * Resolve a requested recipient against what the owner has configured.
 *
 * Accepts an alias name as well as the id it points at, so the console can send `leadership`
 * rather than a raw `C…`, and so a group id that is *not* configured cannot be reached by pasting
 * it — which is the whole point.
 *
 * Returns null for anything unrecognised. Null means refuse: there is no sensible default
 * recipient for a message going to a customer.
 */
export function resolvePushTarget(
  target: string,
  groupAliases: Record<string, string>,
): PushTarget | null {
  const wanted = (target ?? '').trim();
  if (!wanted) return null;

  // A user id, as it arrived on a signed event.
  if (isRawLineId(wanted) && wanted.toLowerCase().startsWith('u')) {
    return { kind: 'user', id: wanted };
  }

  for (const [alias, id] of Object.entries(groupAliases ?? {})) {
    if (wanted === alias || wanted === id) return { kind: 'group', id, alias };
  }

  return null;
}
