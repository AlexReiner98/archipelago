// An admin's press, carried to the server (decision e_ssrawn4v, the owner, 14 Nov 2026: "if an admin user clicks then
// admin powers need to transfer safely, but the click needs to carry it and an agent can't fake it"). The page mints a
// grant the moment a person presses a part's mark (a trusted pointer event, packs/surface/page/part-bridge.js), asking
// press_grant as that person; the server gives one only to a human whose session is an admin, for a part drawn here
// that sends an admin action. The grant stays in the page's host, never in the part's worker, and goes with the one
// admin action the part sends just after: taken here once, by the same person, for the same part and code, within a
// few seconds. Without one a part's admin action is refused (./part-calls.ts).
//
// Grants are held in memory alone: each lives seconds, and a restart only costs a press. Nothing here is a record.

import { randomBytes } from 'node:crypto';
import type { Actor } from '../../write/kernel/pelago.ts';

/** How long a grant lasts, in milliseconds: the press, its round trip and the part's one action. */
export const GRANT_LASTS = 10_000;
/** How many grants may be outstanding at once on this server: an old one past it is dropped. */
const GRANTS_MOST = 1000;

interface Grant { who: string; part: string; at: number }
const grants = new Map<string, Grant>();

/** Who a grant is for: the workspace, and the person as their session names them. */
const whoOf = (workspace: string, actor: Actor) => JSON.stringify([workspace, actor.kind, actor.person ?? '', actor.name]);
/** The part a grant is for: its id and the hash of its code. */
const partOf = (part: { id: string; hash: string }) => `${part.id} ${part.hash}`;

/** Drop what has run out, and the oldest past the most. */
function sweep(now: number): void {
  for (const [k, g] of grants) if (now - g.at > GRANT_LASTS) grants.delete(k);
  while (grants.size >= GRANTS_MOST) grants.delete(grants.keys().next().value!);
}

/** A grant for an admin's press on a part. Throws unless the actor is a human whose session is an admin. */
export function mintGrant(workspace: string, actor: Actor, part: { id: string; hash: string }, now = Date.now()): string {
  if (actor.kind !== 'human') throw new Error('Only a person’s press carries an admin’s authority.');
  if (!actor.admin) throw new Error('Only a workspace admin’s press carries an admin’s authority.');
  sweep(now);
  const grant = randomBytes(24).toString('base64url');
  grants.set(grant, { who: whoOf(workspace, actor), part: partOf(part), at: now });
  return grant;
}

/** Take a grant, once: true only when it was minted for this person and this part, and has not run out. Taken either way. */
export function takeGrant(grant: unknown, workspace: string, actor: Actor, part: { id: string; hash: string }, now = Date.now()): boolean {
  if (typeof grant !== 'string' || !grant) return false;
  const g = grants.get(grant);
  if (!g) return false;
  grants.delete(grant);
  return now - g.at <= GRANT_LASTS && g.who === whoOf(workspace, actor) && g.part === partOf(part);
}
