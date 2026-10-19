// A running system asks for its token, and a person says yes or no: a device-code flow. The system names itself and
// the watched addresses of the parts it will report on (as report matches them, never by item id; a deploy names both
// colours) and is given a short code
// to show and a poll it alone can collect from. The request waits ten minutes, as operational state (transient), not
// as an item. A person who sees the item watched at that address approves or refuses it; on approval, the token is
// made as "Make a token for this" makes it (an agent's, acting for them, within those items, that may only report) the
// first time the system polls, and handed to it then and never again. The secret is never kept and never shown.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createToken } from './auth.ts';
import type { Q } from './db.ts';
import { wholeMap } from './outbox.ts';
import type { Actor, Archipelago, Entity } from './pelago.ts';
import { sameAddress } from './report.ts';
import type { Tool } from './tools.ts';
import { keep, take } from './transient.ts';

/** How long a request waits for an answer and then for its poll. */
export const ASK_MINUTES = 10;
/** The most requests one workspace keeps waiting at once: anyone can ask, so the card cannot be flooded. */
export const ASK_MOST = 20;
/** The letters a code is made of: no vowels, so no words, and nothing read two ways (0 O, 1 I L). */
const LETTERS = 'BCDFGHJKMNPQRSTVWXZ';

export interface Ask {
  id: string;
  code: string;
  name: string;
  addresses: string[];
  may: 'report';
  poll_hash: string;
  asked_at: string;
  expires_at: string;
  state: 'pending' | 'approved' | 'refused' | 'handed';
  /** Who approved it, and the items it is within: set on approval. */
  person?: string;
  items?: string[];
  answered_by?: string;
}

const KEY = 'connect:';
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const left = (a: Ask) => Math.max(1000, Date.parse(a.expires_at) - Date.now());
const newCode = () => Array.from(randomBytes(8), (b, i) => (i === 4 ? '-' : '') + LETTERS[b % LETTERS.length]).join('');

/** The requests still waiting or answered, newest first. */
async function asks(db: Q): Promise<Ask[]> {
  const { rows } = await db.query<{ value: Ask }>(`select value from transient where key like 'connect:%' and until >= now() order by key`);
  return rows.map((r) => r.value).sort((a, b) => b.asked_at.localeCompare(a.asked_at));
}

/** The open item watched at this address, as this view of the map sees it. */
export async function watchedAt(l: Archipelago, address: string): Promise<Entity | undefined> {
  const types = l.registry.having('watch');
  if (!types.length) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [types]);
  const at = sameAddress(address);
  return rows.find((e) => {
    const value = e.props[l.registry.type(e.type)!.capabilities.watch!.field];
    return typeof value === 'string' && sameAddress(value) === at;
  });
}

const ASK_INPUT = z.strictObject({
  workspace: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  address: z.string().trim().min(3).max(300).optional(),
  addresses: z.array(z.string().trim().min(3).max(300)).min(1).max(10).optional(),
  may: z.literal('report').optional(),
});

/** A system's request, as POST /connect/request takes it. Answers what the system shows and polls with. */
export async function askForToken(db: Q, input: unknown) {
  const parsed = ASK_INPUT.safeParse(input ?? {});
  const addresses = [...(parsed.data?.address ? [parsed.data.address] : []), ...(parsed.data?.addresses ?? [])].map(sameAddress);
  if (!parsed.success || !addresses.length) throw new Error(`A request names the system (name), the watched address of each part it reports on (address, or addresses) and may: report.${parsed.success ? '' : `\n${z.prettifyError(parsed.error)}`}`);
  const waiting = (await asks(db)).filter((a) => a.state === 'pending');
  if (waiting.length >= ASK_MOST) throw new Error(`${ASK_MOST} requests are already waiting here. Ask again once they are answered or have run out.`);
  let code = newCode();
  while (waiting.some((a) => a.code === code)) code = newCode();
  const id = `a_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(24).toString('hex');
  const now = Date.now();
  const ask: Ask = { id, code, name: parsed.data.name, addresses: [...new Set(addresses)], may: 'report', poll_hash: hash(secret), asked_at: new Date(now).toISOString(), expires_at: new Date(now + ASK_MINUTES * 60_000).toISOString(), state: 'pending' };
  await keep(db, KEY + id, ask, ASK_MINUTES * 60_000);
  return { id, code, secret, expires_at: ask.expires_at };
}

/**
 * What a poll is told: pending until a person answers, refused, or the token itself, once. A poll that does not
 * hold the request's secret, or comes after the token was handed out or the request ran out, is told it is gone.
 */
export async function pollForToken(db: Q, workspace: string, id: string, secret: string): Promise<{ state: 'pending' | 'refused' | 'gone' } | { state: 'approved'; token: string; name: string; may: 'report' }> {
  const { rows } = await db.query<{ value: Ask }>(`select value from transient where key = $1 and until >= now()`, [KEY + id]);
  const ask = rows[0]?.value;
  const held = ask && timingSafeEqual(Buffer.from(ask.poll_hash), Buffer.from(hash(secret)));
  if (!ask || !held || ask.state === 'handed') return { state: 'gone' };
  if (ask.state !== 'approved') return { state: ask.state };
  // Taken as it is read: of two polls at once, one is given the token and the other is told it is gone.
  const taken = await take<Ask>(db, KEY + id);
  if (taken?.value.state !== 'approved') return { state: 'gone' };
  await keep(db, KEY + id, { ...ask, state: 'handed' }, left(ask));
  const made = await createToken(db, workspace, { kind: 'agent', name: ask.name, entity: ask.person, within: ask.items!, may: 'report' });
  return { state: 'approved', token: made.token, name: made.name, may: 'report' };
}

/** A request as the card shows it: the secret's hash left out, each address with the item watched there, as this person sees it. */
const shown = async (l: Archipelago, a: Ask) => {
  const { poll_hash, person, items, ...rest } = a;
  const watched = await Promise.all(a.addresses.map((at) => watchedAt(l, at)));
  return { ...rest, items: watched.map((e) => (e ? { id: e.id, title: e.title, type: e.type } : null)) };
};

export const ASK_TOOLS: Record<string, Tool> = {
  token_requests: {
    description: 'The systems that have asked for a token (POST /connect/request) and wait for a person to approve or refuse, each with its code and the item watched at each address it named. Only for humans.',
    humanOnly: true,
    input: { within: z.string().optional().describe('Only the requests about this item.') },
    run: async (l, _actor, input) => {
      const whole = await wholeMap(l);
      const listed = await Promise.all((await asks(whole.db)).filter((a) => a.state === 'pending').map((a) => shown(l, a)));
      return listed.filter((a) => !input.within || a.items.some((e) => e?.id === input.within));
    },
  },
  token_request_answer: {
    description: 'Approve or refuse a system’s request for a token. Approved, it is given an agent token that acts for you, within the items watched at the addresses it named, that may only report; the system collects it once, by its poll. Only for humans.',
    humanOnly: true,
    input: { id: z.string(), approve: z.boolean() },
    run: async (l, actor: Actor, input) => {
      const whole = await wholeMap(l);
      const ask = (await asks(whole.db)).find((a) => a.id === input.id);
      if (!ask || ask.state !== 'pending') throw new Error('That request is no longer waiting: it was answered, or ran out.');
      if (!input.approve) {
        await keep(whole.db, KEY + ask.id, { ...ask, state: 'refused', answered_by: actor.name }, left(ask));
        return { refused: ask.id, name: ask.name };
      }
      // As token_create checks it: an agent's token that acts for the one who makes it, within items they can see.
      const items: Entity[] = [];
      for (const at of ask.addresses) {
        const item = await watchedAt(l, at);
        if (!item) throw new Error(`No item you can see is watched at ${at}, so a token cannot be within it. Give the part that address, or refuse.`);
        items.push(item);
      }
      await keep(whole.db, KEY + ask.id, { ...ask, state: 'approved', person: actor.person, items: items.map((e) => e.id), answered_by: actor.name }, left(ask));
      return { approved: ask.id, name: ask.name, within: items.map((e) => ({ id: e.id, title: e.title })), may: 'report' };
    },
  },
};
