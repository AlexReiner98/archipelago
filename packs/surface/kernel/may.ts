// What a session may do on the page, as /whoami answers it (decision e_qpaqnmrc, axis D): the page draws each control
// from this, never from a mode of its own. It says what the server lets the session do and enforces nothing itself:
// a look reads (packs/look_draw/kernel/looks.ts), and a token's `may` holds its writes where they are made (packs/write/kernel/pelago.ts).

import type { Actor } from '../../write/kernel/pelago-types.ts';

/** read: the map as the session sees it; write: a change to it (applied or held); admin: the workspace's members, tokens, settings. */
export type PageMay = 'read' | 'write' | 'admin';

/**
 * What this session may do. `look`: a look pass, which reads only. `narrow`: what a dev server's page asked to try
 * (?may=read), honoured only there, and only ever narrower than the session.
 */
export function pageMay(actor: Actor, look: boolean, narrow?: string | null): PageMay[] {
  // A member who only reads (may 'read', packs/identity/kernel/members.ts) reads, whatever their token says. A token that only reports, or a kind of `may` this module does not know, writes nothing from the page.
  const writes = !look && (actor.may === undefined || actor.may === 'change' || actor.may === 'propose');
  const all: PageMay[] = ['read', ...(writes ? (['write'] as const) : []), ...(writes && actor.admin ? (['admin'] as const) : [])];
  if (!narrow) return all;
  const asked = new Set(narrow.split(',').map((s) => s.trim()));
  return all.filter((m) => m === 'read' || asked.has(m));
}
