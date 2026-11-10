// Guests (decision e_qpaqnmrc, axes B and C): a view shared with someone by their email address. A guest is a member
// whose reach is that view alone, live, and who only reads: every token tied to them reads as pelago_reader under
// their share (src/auth.ts, src/guest-schema.ts), and the database refuses them anything else. What the view holds is
// worked out here as the person who shared it, whenever the log has moved since it was last, and kept in `reach` for
// the database's policies to read. A guest is one view at a time: sharing another with them ends the first.

import { z } from 'zod';
import { needAdmin } from './actor-checks.ts';
import { indexMember } from './control-index.ts';
import { newId, type Q } from './db.ts';
import { stillWritable } from './standing.ts';
import type { Fact } from './log.ts';
import { normalEmail, sendMail } from './mail.ts';
import { LOOK_READS } from './looks.ts';
import { INVITE_DAYS, linkFor, memberOf } from './members.ts';
import { wholeMap } from './outbox.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { isKept, keptPicture } from './query-saved.ts';
import { openSaid } from './seal.ts';
import { headPos, type FactsAfter } from './tail.ts';
import type { Tool } from './tools.ts';

/** The tools a guest may call: the reads a canvas makes, as a look's, and the page's feed of the log. The database refuses them what is not the view's. */
export const GUEST_READS = new Set([...LOOK_READS, 'tail']);

/** Entries a guest's feed reads in one call at most, as a member's does (src/tail.ts). */
const ENTRIES = 500;

/** Share a view with a guest by their address: their person (one with that address, or a new one), the share, and their membership. */
export async function shareAsGuest(l: Archipelago, actor: Actor, input: { id: string; email: string }) {
  needAdmin(actor, 'share a view with a guest');
  const email = normalEmail(input.email);
  if (!email) throw new Error(`"${input.email}" is not an email address.`);
  const view = await l.entity(input.id);
  if (!view || !isKept(l, view.type)) throw new Error(`"${input.id}" is not a view you can read: only a view can be shared with a guest.`);
  if (view.archived_at) throw new Error(`"${view.title}" is archived.`);
  const whole = await wholeMap(l);
  const was = await memberOf(whole.db, email);
  if (was && !was.reads) throw new Error(`${email} is a member already: they read the whole map.`);
  await stillWritable(l.workspace);
  const { rows } = await whole.db.query<{ id: string }>(`select id from entity where type = 'person' and archived_at is null and lower(props->>'email') = $1 order by created_at limit 1`, [email]);
  const person =
    rows[0]?.id ??
    (await l.apply(actorId(actor), { ops: [{ op: 'create', ref: 'p', type: 'person', title: email, visibility: 'shared', props: { email } }], reason: 'A view was shared with them as a guest' })).created.p;
  const share = newId('s');
  const by = actor.person ?? (await whole.setting<string>('me')) ?? '';
  await whole.db.transaction(async (tx: Q) => {
    if (was?.reads) await tx.query(`update share set revoked_at = now() where id = $1 and revoked_at is null`, [was.reads]);
    await tx.query(`insert into share (id, workspace, hint, entity_id, made_by, guest) values ($1, $2, $3, $4, $5, $6)`, [share, l.workspace, email, view.id, by, person]);
    await tx.query(
      `insert into member (email, person_id, admin, added_by, reads) values ($1, $2, false, $3, $4)
       on conflict (email) do update set person_id = excluded.person_id, admin = false, added_by = excluded.added_by, added_at = now(), removed_at = null, reads = excluded.reads`,
      [email, person, actor.name, share],
    );
    await l.log(tx, { actor: `${actor.kind}:${actor.name}`, action: 'share.guest', target: view.id, reason: 'A view was shared with a guest, to read live', detail: { share } });
  });
  await indexMember(email, l.workspace, true);
  try {
    await sendMail({
      to: email,
      subject: `${actor.name} shared "${view.title}" with you on Archipelago`,
      text: [
        'Hello,',
        `${actor.name} has shared the view "${view.title}" with you on Archipelago. You can read it as it changes; nothing else of the map is shown to you.`,
        `To open it, follow this link. It signs you in on this device and works once, for ${INVITE_DAYS} days:`,
        await linkFor(whole.db, l.workspace, email, INVITE_DAYS * 86_400_000),
        '- Archipelago',
      ].join('\n\n'),
    });
    return { share, email, person, view: view.id, invited: true };
  } catch (err) {
    return { share, email, person, view: view.id, invited: false, error: (err as Error).message };
  }
}

/** A share that has ended, or is not the guest's: refused, never an error of the server's. */
export class ShareEnded extends Error {
  constructor() {
    super('This view is no longer shared with you.');
  }
}

/** The log's head each share's reach was last worked out at, by workspace and share: worked out again once it moves. */
const reachedAt = new Map<string, number>();

/**
 * The map as a guest reads it, their reach made current first. Refused when the share has ended or is not theirs.
 * Given the whole map, as the server holds it.
 */
export async function guestMap(whole: Archipelago, share: string, guest: string): Promise<Archipelago> {
  const { rows } = await whole.db.query<{ entity_id: string; made_by: string; guest: string | null; revoked_at: Date | null }>(`select entity_id, made_by, guest, revoked_at from share where id = $1`, [share]);
  const s = rows[0];
  if (!s || s.revoked_at || s.guest !== guest) throw new ShareEnded();
  const key = `${whole.workspace}:${share}`;
  const pos = await headPos(whole.db);
  if (reachedAt.get(key) !== pos) {
    await reachOf(whole, share, s.entity_id, s.made_by);
    reachedAt.set(key, pos);
  }
  return whole.asReader(share, guest);
}

/** What a share's view holds now, as the person who shared it sees it: the view itself, its items and the links among them. */
export async function reachOf(whole: Archipelago, share: string, view: string, sharer: string): Promise<string[]> {
  const picture = await keptPicture(whole.as(sharer), view);
  const ids = [...new Set([view, ...picture.items.map((i) => i.id), ...picture.links.map((r) => r.id)])];
  await whole.db.transaction(async (tx: Q) => {
    await tx.query(`delete from reach where share_id = $1`, [share]);
    await tx.query(`insert into reach (share_id, id) select $1, unnest($2::text[]) on conflict do nothing`, [share, ids]);
  });
  return ids;
}

type Said = { pos: number; at: string; n: number; op: '+' | '-'; id: string; field: string; value: unknown; meta: Record<string, unknown> | null };

/**
 * A guest's feed of the log, for the page to project as a member's (src/tail.ts): the facts after `after` on what
 * their view holds, read through the one function the reader role may call, sealed words opened with the keys of what
 * they may see. `gone` is what the page holds that they can no longer see.
 */
export async function guestFacts(l: Archipelago, input: { after?: number; ids?: string[] }): Promise<{ pos: number } | FactsAfter> {
  if (input.after === undefined) return { pos: (await l.db.query<{ pos: number }>(`select pelago_reader_head() as pos`)).rows[0].pos };
  const { rows } = await l.db.query<{ feed: { last: number | null; more: boolean; facts: Said[] } | null }>(`select pelago_reader_facts($1, $2) as feed`, [input.after, ENTRIES]);
  const feed = rows[0]?.feed;
  if (!feed) throw new ShareEnded();
  if (feed.last === null) return { pos: input.after, entries: [], gone: [], made: 0 };
  const opened = await openSaid(l.db, feed.facts);
  const by = new Map<number, { at: string; facts: Fact[] }>();
  for (const r of opened) {
    const fact = (r.op === '-' ? ['-', r.id, r.field] : r.meta ? ['+', r.id, r.field, r.value, r.meta] : ['+', r.id, r.field, r.value]) as Fact;
    const entry = by.get(r.pos) ?? { at: new Date(r.at).toISOString(), facts: [] };
    entry.facts.push(fact);
    by.set(r.pos, entry);
  }
  const held = [...new Set(input.ids ?? [])];
  const { rows: seen } = held.length ? await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) union all select id from relation where id = any($1::text[])`, [held]) : { rows: [] };
  const visible = new Set(seen.map((r) => r.id));
  const made = opened.filter((r) => r.op === '+' && r.field === 'type' && r.id.startsWith('e_')).length;
  return { pos: feed.last, entries: [...by].map(([pos, e]) => ({ pos, ...e })), gone: held.filter((id) => !visible.has(id)), made, ...(feed.more && { more: true as const }) };
}

export const GUEST_TOOLS: Record<string, Tool> = {
  share_guest: {
    description: `Share one view with a guest by their email address: a member who signs in to read that view as it changes, and nothing else of the map. They are sent an invitation (it works for ${INVITE_DAYS} days). Sharing another view with a guest ends the one they had. Admins only.`,
    humanOnly: true,
    input: { id: z.string().describe('The view (a lens).'), email: z.string().min(3) },
    run: (l, actor, input) => shareAsGuest(l, actor, input),
  },
};
