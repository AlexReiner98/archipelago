// A running system asks for its token, and a person says yes or no: a device-code flow. The system names itself and
// the watched addresses of the parts it will report on (as report matches them, never by item id; a deploy names both
// colours) and is given a short code
// to show and a poll it alone can collect from. The request waits ten minutes, as operational state (transient), not
// as an item. A person who sees the item watched at that address approves or refuses it; on approval, the token is
// made as "Make a token for this" makes it (an agent's, acting for them, within those items, that may only report) the
// first time the system polls, and handed to it then and never again. The secret is never kept and never shown.
//
// On the connect pack's context: the requests are kept under `connect:` in the whole workspace's transient store
// (root.transient), the token is made by identity (root.token, an agent's that may only report), and the items watched
// at an address are read as the asker under row-level security. The tools' inputs are JSON shapes the surface builds
// its schemas from; the adapter at src/token-ask.ts hands each run the pack's context of its map.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { KernelContext } from '#pelago/kernel';

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

/** Who answers a request, as the kernel hands it (src/pelago-types.ts, Actor): only what is read of it here. */
export interface Asker {
  kind: 'human' | 'agent';
  name: string;
  person?: string;
}

/** An item as the reads give it. */
interface Item {
  id: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  is_open?: boolean;
  archived_at?: unknown;
}

const KEY = 'connect:';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const randomHex = (bytes: number) => randomBytes(bytes).toString('hex');
/** Whether two strings are the same, in a time that does not say how much of them is (src/hashes.ts, sameBytes). */
const sameBytes = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const left = (a: Ask) => Math.max(1000, Date.parse(a.expires_at) - Date.now());
const newCode = () => Array.from(randomBytes(8), (b, i) => (i === 4 ? '-' : '') + LETTERS[b % LETTERS.length]).join('');

/** An address as compared: no trailing slash, scheme and host in lower case (the monitoring pack's, copied). */
export function sameAddress(a: string): string {
  const s = a.trim().replace(/\/+$/, '');
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i.exec(s);
  return m ? m[1].toLowerCase() + m[2] : s;
}

/** The store, as the whole workspace keeps it: keep a request, read one, or every one. */
const keep = (ctx: KernelContext, a: Ask, ms: number) => ctx.call('root.transient', { keep: { key: KEY + a.id, value: a, ms } });
const kept = (ctx: KernelContext, id: string) => ctx.call<unknown, Ask | undefined>('root.transient', { kept: KEY + id });
const taken = (ctx: KernelContext, id: string) => ctx.call<unknown, { value: Ask } | undefined>('root.transient', { take: KEY + id });

/** The requests still waiting or answered, newest first. */
async function asks(ctx: KernelContext): Promise<Ask[]> {
  const rows = await ctx.call<unknown, { key: string; value: Ask }[]>('root.transient', { scan: { prefixes: [KEY] } });
  return rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => r.value).sort((a, b) => b.asked_at.localeCompare(a.asked_at));
}

/** The open item watched at this address, as this view of the map sees it. */
export async function watchedAt(ctx: KernelContext, address: string): Promise<Item | undefined> {
  const types = ctx.registry.having('watch');
  if (!types.length) return undefined;
  const at = sameAddress(address);
  for (const type of types) {
    for (let after: string | undefined, first = true; first || after; first = false) {
      const { rows, next } = (await ctx.reads({ items: { type }, page: { ...(after && { after }) } })) as { rows: Item[]; next?: string };
      const found = rows.find((e) => {
        if (e.is_open === false || e.archived_at) return false;
        const value = e.props[ctx.registry.type(e.type)!.capabilities.watch!.field];
        return typeof value === 'string' && sameAddress(value) === at;
      });
      if (found) return found;
      after = next;
    }
  }
  return undefined;
}

/** What is wrong with a request, as POST /connect/request takes it: each problem, or none. */
function problems(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const text = (v: unknown, at: string, min: number, max: number) => {
    if (typeof v !== 'string') return out.push(`✖ Invalid input: expected string, received ${v === null ? 'null' : typeof v}\n  → at ${at}`);
    const n = v.trim().length;
    if (n < min) out.push(`✖ Too small: expected string to have >=${min} characters\n  → at ${at}`);
    if (n > max) out.push(`✖ Too big: expected string to have <=${max} characters\n  → at ${at}`);
  };
  for (const key of Object.keys(input)) if (!['workspace', 'name', 'address', 'addresses', 'may'].includes(key)) out.push(`✖ Unrecognized key: "${key}"`);
  if (input.workspace !== undefined && typeof input.workspace !== 'string') out.push(`✖ Invalid input: expected string, received ${typeof input.workspace}\n  → at workspace`);
  text(input.name, 'name', 1, 60);
  if (input.address !== undefined) text(input.address, 'address', 3, 300);
  if (input.addresses !== undefined) {
    if (!Array.isArray(input.addresses)) out.push(`✖ Invalid input: expected array, received ${typeof input.addresses}\n  → at addresses`);
    else {
      if (input.addresses.length < 1) out.push('✖ Too small: expected array to have >=1 items\n  → at addresses');
      if (input.addresses.length > 10) out.push('✖ Too big: expected array to have <=10 items\n  → at addresses');
      input.addresses.forEach((a, i) => text(a, `addresses[${i}]`, 3, 300));
    }
  }
  if (input.may !== undefined && input.may !== 'report') out.push('✖ Invalid input: expected "report"\n  → at may');
  return out;
}

/** A system's request, as POST /connect/request takes it. Answers what the system shows and polls with. */
export async function askForToken(ctx: KernelContext, input: unknown) {
  const given = (input ?? {}) as Record<string, unknown>;
  const wrong = typeof given === 'object' && !Array.isArray(given) ? problems(given) : ['✖ Invalid input: expected object'];
  const ok = !wrong.length;
  const addresses = ok ? [...(given.address ? [given.address as string] : []), ...((given.addresses as string[] | undefined) ?? [])].map((a) => sameAddress(a.trim())) : [];
  if (!ok || !addresses.length) throw new Error(`A request names the system (name), the watched address of each part it reports on (address, or addresses) and may: report.${ok ? '' : `\n${wrong.join('\n')}`}`);
  const waiting = (await asks(ctx)).filter((a) => a.state === 'pending');
  if (waiting.length >= ASK_MOST) throw new Error(`${ASK_MOST} requests are already waiting here. Ask again once they are answered or have run out.`);
  let code = newCode();
  while (waiting.some((a) => a.code === code)) code = newCode();
  const id = `a_${randomHex(6)}`;
  const secret = randomHex(24);
  const now = Date.now();
  const ask: Ask = { id, code, name: (given.name as string).trim(), addresses: [...new Set(addresses)], may: 'report', poll_hash: hash(secret), asked_at: new Date(now).toISOString(), expires_at: new Date(now + ASK_MINUTES * 60_000).toISOString(), state: 'pending' };
  await keep(ctx, ask, ASK_MINUTES * 60_000);
  return { id, code, secret, expires_at: ask.expires_at };
}

/**
 * What a poll is told: pending until a person answers, refused, or the token itself, once. A poll that does not
 * hold the request's secret, or comes after the token was handed out or the request ran out, is told it is gone.
 */
export async function pollForToken(ctx: KernelContext, id: string, secret: string): Promise<{ state: 'pending' | 'refused' | 'gone' } | { state: 'approved'; token: string; name: string; may: 'report' }> {
  const ask = await kept(ctx, id);
  const held = ask && sameBytes(ask.poll_hash, hash(secret));
  if (!ask || !held || ask.state === 'handed') return { state: 'gone' };
  if (ask.state !== 'approved') return { state: ask.state };
  // Taken as it is read: of two polls at once, one is given the token and the other is told it is gone.
  const took = await taken(ctx, id);
  if (took?.value.state !== 'approved') return { state: 'gone' };
  await keep(ctx, { ...ask, state: 'handed' }, left(ask));
  const made = await ctx.call<unknown, { token: string; name: string }>('root.token', { name: ask.name, person: ask.person, within: ask.items! });
  return { state: 'approved', token: made.token, name: made.name, may: 'report' };
}

/** A request as the card shows it: the secret's hash left out, each address with the item watched there, as this person sees it. */
const shown = async (ctx: KernelContext, a: Ask) => {
  const { poll_hash, person, items, ...rest } = a;
  const watched = await Promise.all(a.addresses.map((at) => watchedAt(ctx, at)));
  return { ...rest, items: watched.map((e) => (e ? { id: e.id, title: e.title, type: e.type } : null)) };
};

/** A tool as this pack declares it: its input a JSON shape, what each field is for in `says`, run on the pack's context. */
export interface AskTool {
  description: string;
  humanOnly?: boolean;
  input: Record<string, unknown>;
  says?: Record<string, string>;
  run(ctx: KernelContext, actor: Asker, input: any): Promise<unknown>;
}

export const ASK_TOOLS: Record<string, AskTool> = {
  token_requests: {
    description: 'The systems that have asked for a token (POST /connect/request) and wait for a person to approve or refuse, each with its code and the item watched at each address it named. With answered, also those answered and not yet run out: state approved, refused, or handed (the system has collected its token). Only for humans.',
    humanOnly: true,
    input: { 'within?': 'string', 'answered?': 'boolean' },
    says: { within: 'Only the requests about this item.', answered: 'Also the requests answered in their ten minutes.' },
    run: async (ctx, _actor, input: { within?: string; answered?: boolean }) => {
      const listed = await Promise.all((await asks(ctx)).filter((a) => input.answered || a.state === 'pending').map((a) => shown(ctx, a)));
      return listed.filter((a) => !input.within || a.items.some((e) => e?.id === input.within));
    },
  },
  token_request_answer: {
    description: 'Approve or refuse a system’s request for a token. Approved, it is given an agent token that acts for you, within the items watched at the addresses it named, that may only report; the system collects it once, by its poll. Only for humans.',
    humanOnly: true,
    input: { id: 'string', approve: 'boolean' },
    run: async (ctx, actor, input: { id: string; approve: boolean }) => {
      const ask = (await asks(ctx)).find((a) => a.id === input.id);
      if (!ask || ask.state !== 'pending') throw new Error('That request is no longer waiting: it was answered, or ran out.');
      if (!input.approve) {
        await keep(ctx, { ...ask, state: 'refused', answered_by: actor.name }, left(ask));
        return { refused: ask.id, name: ask.name };
      }
      // As token_create checks it: an agent's token that acts for the one who makes it, within items they can see.
      const items: Item[] = [];
      for (const at of ask.addresses) {
        const item = await watchedAt(ctx, at);
        if (!item) throw new Error(`No item you can see is watched at ${at}, so a token cannot be within it. Give the part that address, or refuse.`);
        items.push(item);
      }
      await keep(ctx, { ...ask, state: 'approved', person: actor.person, items: items.map((e) => e.id), answered_by: actor.name }, left(ask));
      return { approved: ask.id, name: ask.name, within: items.map((e) => ({ id: e.id, title: e.title })), may: 'report' };
    },
  },
};
