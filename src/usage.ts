// How much of what its plan limits a workspace uses, and what that use is made of: the usage view, read alike by a
// member, their agents and the page (a lens that names this view draws it on the canvas, the plan pack's Usage
// canvas). It answers as a lens does, items and the links among them, so a drawing can draw it: an item for each
// limit, and one for each part of it, part_of its limit. A part that stands for an item of the map (a session at
// work, a person, an item that takes up storage) names it (`use.item`), so a click opens its page.
//
// Whoever reads it is told only what they may see: an item they cannot read is summed into one part with no title
// or type of its own. Members, seats and where the plan is managed are an admin's (the owner, 29 Oct 2026). Nothing
// is read row by row: storage is the database's count of each table's size and the counts kept beside the log
// (src/bytes.ts), sessions the open runs heard from in the hour, requests and looks the server's own counts.

import { bytesByType, largestItems } from './bytes.ts';
import { looksBy, looksThisHour } from './looks.ts';
import { limitOf } from './members.ts';
import { wholeMap } from './outbox.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { awakeSessions, bytes, LIMITS, NEAR, requestsBy, requestsThisMinute, SESSION_AWAKE_MS, storageOf, storageParts, useOf, type LimitName } from './plan.ts';

/** How many of the largest items are named, and how many types. */
const LARGEST = 12;
const TYPES = 12;

/** What each limit is called, and what each of the parts storage counts. */
const NAMES: Record<LimitName, string> = { storage: 'Storage', sessions: 'Agent sessions at once', requests: 'Requests this minute', looks: 'Looks this hour', members: 'Members' };
const STORED: Record<string, string> = { log_fact: 'What was said: facts', log_entry: 'Who changed what, and why', log_op: 'Places, presence and other streams', picture: 'Images' };

/** One measured thing, as the drawing reads it (`use`). */
interface Use {
  /** limit: a limit of the plan; share: a share of its limit, drawn in its bar; row: a line under it, in its list. */
  as: 'limit' | 'share' | 'row';
  used: number;
  /** The words for used: "212 MB", "3". */
  shown: string;
  /** What the plan allows, and in words, when it limits this. */
  of?: number;
  of_shown?: string;
  /** Used over what it is drawn against: its plan's allowance, else its limit's use (its share of it). */
  share: number;
  near?: boolean;
  over?: boolean;
  /** For a row: which list under its limit it is in. */
  list?: string;
  /** The item of the map it stands for, whose page a click opens. */
  item?: string;
}

interface Item {
  id: string;
  kind: string;
  type: string;
  title: string;
  open: boolean;
  status: string;
  use: Use;
}

const ratio = (n: number, of: number) => (of > 0 ? Math.min(n / of, 1) : 0);

/** The usage view: every limit the workspace's plan sets (all of them where it sets none), with what each is made of. */
export async function usage(l: Archipelago, _input: Record<string, unknown>, actor?: Actor) {
  const limits = await limitOf(l.workspace);
  const admin = Boolean(actor?.admin);
  const whole = await wholeMap(l);
  const items: Item[] = [];
  const links: { id: string; type: string; from: string; to: string; props: Record<string, unknown> }[] = [];
  let n = 0;
  const part = (to: string, item: Item) => (items.push(item), links.push({ id: `u_${++n}`, type: 'part_of', from: item.id, to, props: {} }));
  const show = (name: LimitName, used: number) => (name === 'storage' ? bytes(used) : String(used));

  // Titles of the items named, as the reader may see them: one they cannot read is not named.
  const titlesOf = async (ids: string[]) => {
    const { rows } = ids.length ? await l.db.query<{ id: string; title: string; type: string }>(`select id, title, type from entity where id = any($1::text[])`, [ids]) : { rows: [] };
    return new Map(rows.map((r) => [r.id, r]));
  };
  const typeName = (t: string) => (t === 'links' ? 'Links' : t === 'packs' ? 'Packs' : t === 'other' ? 'Other' : (l.registry.type(t)?.title ?? t));

  const used = {} as Record<LimitName, number>;
  used.storage = await storageOf(l.workspace);
  used.sessions = await awakeSessions(whole.db, l.registry.family('run'));
  used.requests = requestsThisMinute(l.workspace);
  used.looks = looksThisHour(l.workspace);
  if (admin) used.members = Number((await whole.db.query<{ n: number }>(`select count(*)::int as n from member where removed_at is null`)).rows[0].n);
  const allowed = limits ? Object.fromEntries(useOf(limits, used).map((u) => [u.name, u])) : {};

  for (const name of LIMITS) {
    if (name === 'members' && !admin) continue;
    const at = allowed[name];
    const id = `use:${name}`;
    const of = limits?.[name];
    items.push({
      id,
      kind: 'record',
      type: 'usage',
      title: NAMES[name],
      open: true,
      status: at?.over ? 'over' : at?.near ? 'near' : 'within',
      use: { as: 'limit', used: used[name], shown: show(name, used[name]), share: of ? ratio(used[name], of) : 1, ...(of && { of, of_shown: at!.of, near: at!.near, over: at!.over }) },
    });
    // What each part is drawn against: the plan's allowance, else the limit's own use.
    const against = of ?? used[name];
    // A share is drawn in its limit's bar; a row in a list under it.
    const piece = (pid: string, title: string, n: number, item?: string, list?: string): Item => ({
      id: pid,
      kind: 'record',
      type: 'usage',
      title,
      open: true,
      status: 'within',
      use: { as: list ? 'row' : 'share', used: n, shown: show(name, n), share: ratio(n, against), ...(list && { list }), ...(item && { item }) },
    });

    if (name === 'storage') {
      const parts = await storageParts(whole.db);
      for (const [table, n] of Object.entries(parts)) if (n) part(id, piece(`use:storage:${table}`, STORED[table], n));
      // What the facts are about: by type, and the largest items the reader may see. Counted as stored, so these
      // are shares of the facts, not of the table's size on disk (its indexes and pages).
      const types = await bytesByType(whole.db);
      const said = types.reduce((a, t) => a + t.bytes, 0);
      const row = (pid: string, title: string, n: number, list: string, item?: string) => part(id, { ...piece(pid, title, n), use: { as: 'row', list, used: n, shown: bytes(n), share: ratio(n, said), ...(item && { item }) } });
      for (const t of types.slice(0, TYPES)) row(`use:storage:type:${t.type}`, typeName(t.type), t.bytes, 'By type');
      const rest = types.slice(TYPES).reduce((a, t) => a + t.bytes, 0);
      if (rest) row('use:storage:type:rest', 'Every other type', rest, 'By type');
      const largest = await largestItems(whole.db, LARGEST);
      const seen = await titlesOf(largest.map((x) => x.id));
      // What the reader cannot see is one row, among the rest by its size.
      const named: [string, string, number, string?][] = [];
      let hidden = 0;
      for (const x of largest.slice(0, LARGEST)) {
        const it = seen.get(x.id);
        if (it) named.push([`use:storage:item:${x.id}`, it.title, x.bytes, x.id]);
        else hidden += x.bytes;
      }
      if (hidden) named.push(['use:storage:hidden', 'Items you cannot see', hidden]);
      for (const [pid, title, n, item] of named.sort((a, b) => b[2] - a[2])) row(pid, title, n, 'Largest items', item);
    }

    if (name === 'sessions') {
      const since = new Date(Date.now() - SESSION_AWAKE_MS).toISOString();
      const { rows } = await l.db.query<{ id: string; title: string; type: string }>(
        `select id, title, type from entity where type = any($2::text[]) and is_open and archived_at is null and props->>'last_seen' >= $1 order by props->>'last_seen' desc`,
        [since, l.registry.family('run')],
      );
      for (const r of rows) part(id, piece(`use:sessions:${r.id}`, r.title, 1, r.id, 'At work'));
      if (used.sessions > rows.length) part(id, piece('use:sessions:hidden', 'Sessions you cannot see', used.sessions - rows.length, undefined, 'At work'));
    }

    if (name === 'requests' || name === 'looks') {
      const by = name === 'requests' ? requestsBy(l.workspace) : looksBy(l.workspace);
      const who = new Map<string, number>();
      // An agent's are counted as its person's agents; a person's by the person.
      for (const [key, count] of by) who.set(key, (who.get(key) ?? 0) + count);
      const people = await titlesOf([...who.keys()].map((k) => k.replace(/^agent:/, '')).filter((k) => /^e_/.test(k)));
      for (const [key, count] of [...who].sort((a, b) => b[1] - a[1])) {
        const agent = key.startsWith('agent:'), person = people.get(key.replace(/^agent:/, ''));
        const title = person ? (agent ? `${person.title}'s agents` : person.title) : agent ? 'Agents' : 'Someone';
        part(id, piece(`use:${name}:${key}`, title, count, person && !agent ? person.id : undefined, 'By who asked'));
      }
    }

    if (name === 'members') {
      const { rows } = await whole.db.query<{ person_id: string }>(`select person_id from member where removed_at is null and person_id is not null`);
      const people = await titlesOf(rows.map((r) => r.person_id));
      for (const r of rows) part(id, piece(`use:members:${r.person_id}`, people.get(r.person_id)?.title ?? 'A member', 1, people.has(r.person_id) ? r.person_id : undefined, 'By person'));
    }
  }

  return {
    as_of: new Date().toISOString(),
    plan: limits?.plan ?? null,
    near_at: NEAR,
    ...(admin && limits?.manage && { manage: limits.manage }),
    ...(limits?.note && { note: limits.note }),
    lens: { view: 'usage' },
    items,
    links,
  };
}
