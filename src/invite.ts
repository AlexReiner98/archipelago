// A sign-in link: what an admin sends a person in place of a token. The link carries a code that works once, for a
// week; opened, the page trades it (POST /connect/join) for the person's own human token, which the browser keeps and
// nobody ever has to see, copy or paste. The code is kept only as a hash, as operational state (transient), so a link
// that was never opened leaves nothing behind, and one read off an email after it was used opens nothing.

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createToken, listTokens } from './auth.ts';
import type { Q } from './db.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { keep, take } from './transient.ts';

/** How long a link works if it is not opened. */
export const INVITE_DAYS = 7;
const KEY = 'invite:';
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** Who a link signs in: the token it is traded for is made as this says. */
export interface Invite {
  name: string;
  entity?: string;
  admin: boolean;
}

/** Make a link's code. It names its workspace, as a token does, so the server knows where to trade it. */
export async function makeInvite(db: Q, workspace: string, invite: Invite): Promise<{ code: string; expires_at: string }> {
  const code = `inv_${workspace}_${randomBytes(20).toString('hex')}`;
  const ms = INVITE_DAYS * 86_400_000;
  await keep(db, KEY + hash(code), invite, ms);
  return { code, expires_at: new Date(Date.now() + ms).toISOString() };
}

/** Which workspace a code claims to be for. Says nothing about whether it is valid. */
export function workspaceOfInvite(code: string): string | undefined {
  return /^inv_([a-z0-9][a-z0-9-]{0,39})_[a-f0-9]{40}$/.exec(code)?.[1];
}

/** Trade a code for its token, once: a second opening of the same link, or one after it ran out, is given nothing. */
export async function redeemInvite(db: Q, workspace: string, code: string): Promise<string | undefined> {
  const taken = await take<Invite>(db, KEY + hash(code));
  if (!taken) return undefined;
  const { name, entity, admin } = taken.value;
  return (await createToken(db, workspace, { kind: 'human', name, entity, admin })).token;
}

/** A new link for someone, made by an admin; the tools below and member_add use it. */
export async function inviteFor(l: Archipelago, invite: Invite) {
  return makeInvite((await wholeMap(l)).db, l.workspace, invite);
}

export const INVITE_TOOLS: Record<string, Tool> = {
  sign_in_link: {
    description: `A new sign-in link for a member who has one of this workspace's human tokens: for a new device, or one whose link was lost. It signs them in as that token does (same person, same admin), works once, for ${INVITE_DAYS} days. The old token keeps working until it is revoked. Admins only.`,
    humanOnly: true,
    input: { token: z.string().describe('The id of the member’s human token, from token_list.') },
    run: async (l, actor, input) => {
      if (!actor.admin) throw new Error('Only a workspace admin can make a sign-in link.');
      const t = (await listTokens(l.db)).find((k) => k.id === input.token && k.kind === 'human' && !k.revoked_at);
      if (!t) throw new Error(`No live human token "${input.token}".`);
      return { name: t.name, ...(await inviteFor(l, { name: t.name, entity: t.entity_id ?? undefined, admin: t.admin })) };
    },
  },
};
