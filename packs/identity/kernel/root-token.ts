// The root service root.token (docs/kernel-packs.md, "Root services"): the token a person approved a running system's
// request for (the connect pack's token-ask), made on the map that asks and nothing more: an agent's, acting for that
// person, within the items it was approved for, that may only report. Only the connect pack calls it
// (packs/roots.json); no other kind of token can be asked of it.

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { createToken } from './auth.ts';

const ID = /^e_[a-z0-9]{8}$/;

/** Make the report-only agent token an approved request is handed: answers the token, once, and its name. */
export async function tokenOf(call: RootCall, ask: { name: string; person?: string; within: string[] }): Promise<{ token: string; name: string }> {
  const l = call.map;
  if (!l) throw new Error('root.token makes a workspace\'s token: call it from its map');
  const { name, person, within } = ask ?? ({} as typeof ask);
  if (typeof name !== 'string' || !name.trim() || (person !== undefined && person !== null && !ID.test(person)) || !Array.isArray(within) || !within.length || !within.every((id) => typeof id === 'string' && ID.test(id)))
    throw new Error('root.token makes a token for an approved request: its name, the person it acts for, and the items it is within');
  const made = await createToken(l.db, l.workspace, { kind: 'agent', name, entity: person ?? undefined, within, may: 'report' });
  return { token: made.token, name: made.name };
}
