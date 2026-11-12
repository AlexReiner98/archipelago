// How much of what the server limits a workspace uses, and what that use is made of: the usage view, read alike by a
// member, their agents and the page (a lens that names this view draws it on the canvas, as a
// pack's Usage canvas does). It answers as a lens does, items and the links among them, so a drawing can draw it: an item for each
// limit, and one for each part of it, part_of its limit. A part that stands for an item of the map (a session at
// work, a person, an item that takes up storage) names it (`use.item`), so a click opens its page.
//
// Whoever reads it is told only what they may see: an item they cannot read is summed into one part with no title
// or type of its own. Members are an admin's (the owner, 29 Oct 2026). Nothing
// is read row by row: storage is the database's count of each table's size and the counts kept beside the log
// (packs/log/kernel/bytes.ts), sessions the open runs heard from in the hour, requests and looks the server's own counts.

import type { KernelContext } from '#pelago/kernel';

/** A limit the server sets a workspace (packs/identity/kernel/standing.ts). */
type LimitName = 'members' | 'storage' | 'requests' | 'sessions' | 'looks';
/** What one limit allows and how near it is, as the server says it (useOf, packs/identity/kernel/standing.ts). */
interface Allowed { name: LimitName; of: string; near: boolean; over: boolean }
/** What the server counts of a workspace (root.counters, packs/surface/kernel/workspace-tools.ts). */
interface Counters {
  limits: (Partial<Record<LimitName, number>> & { note?: string }) | null;
  near: number;
  order: LimitName[];
  used: Record<LimitName, number>;
  allowed: Allowed[];
  storage_parts: Record<string, number>;
  bytes_by_type: { type: string; bytes: number }[];
  largest: { id: string; type: string; bytes: number }[];
  requests_by: [string, number][];
  looks_by: [string, number][];
  /** The sessions at work, newest heard from first. */
  awake: string[];
  /** The members' people, for an admin. */
  members?: string[];
}

/** A number of bytes as a person reads it (as packs/surface/kernel/workspace-use.ts says it). */
const bytes = (n: number) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} bytes`);

/** How many of the largest items are named, and how many types. */
const LARGEST = 12;
const TYPES = 12;

/** What each limit is called, and what each of the parts storage counts. */
const NAMES: Record<LimitName, string> = { storage: 'Storage', sessions: 'Agent sessions at once', requests: 'Requests this minute', looks: 'Looks this hour', members: 'Members' };
const STORED: Record<string, string> = { log_fact: 'What was said: facts', log_entry: 'Who changed what, and why', log_op: 'Places, presence and other streams', picture: 'Images' };

/** One measured thing, as the drawing reads it (`use`). */
interface Use {
  /** limit: a limit the server sets (packs/identity/kernel/standing.ts); share: a share of its limit, drawn in its bar; row: a line under it, in its list. */
  as: 'limit' | 'share' | 'row';
  used: number;
  /** The words for used: "212 MB", "3". */
  shown: string;
  /** What the limit allows, and in words, when it limits this. */
  of?: number;
  of_shown?: string;
  /** Used over what it is drawn against: its limit, else its own use (its share of it); a limit with no allowance, 0. */
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

/** The usage view: every limit the server sets the workspace (all of them where it sets none), with what each is made of. */
export async function usage(ctx: KernelContext, _input: Record<string, unknown>, actor?: { admin?: boolean }) {
  const admin = Boolean(actor?.admin);
  // What the server counts, whole (root.counters): each item it names is read below as the reader, under their row-level security.
  const counted = await ctx.call<unknown, Counters>('root.counters', { admin, runs: ctx.registry.family('run'), largest: LARGEST });
  const limits = counted.limits ?? undefined;
  const items: Item[] = [];
  const links: { id: string; type: string; from: string; to: string; props: Record<string, unknown> }[] = [];
  let n = 0;
  const part = (to: string, item: Item) => (items.push(item), links.push({ id: `u_${++n}`, type: 'part_of', from: item.id, to, props: {} }));
  const show = (name: LimitName, used: number) => (name === 'storage' ? bytes(used) : String(used));

  // Titles of the items named, as the reader may see them: one they cannot read is not named.
  const titlesOf = async (ids: string[]) => {
    const rows = ids.length ? ((await ctx.reads({ ids })) as { id: string; title: string; type: string }[]) : [];
    return new Map(rows.map((r) => [r.id, r]));
  };
  const typeName = (t: string) => (t === 'links' ? 'Links' : t === 'packs' ? 'Packs' : t === 'other' ? 'Other' : (ctx.registry.type(t)?.title ?? t));

  const used = counted.used;
  const allowed: Partial<Record<LimitName, Allowed>> = Object.fromEntries(counted.allowed.map((u) => [u.name, u]));

  for (const name of counted.order) {
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
      use: { as: 'limit', used: used[name], shown: show(name, used[name]), share: of ? ratio(used[name], of) : 0, ...(of && { of, of_shown: at!.of, near: at!.near, over: at!.over }) },
    });
    // What each part is drawn against: the limit, else the limit's own use.
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
      const parts = counted.storage_parts;
      for (const [table, n] of Object.entries(parts)) if (n) part(id, piece(`use:storage:${table}`, STORED[table], n));
      // What the facts are about: by type, and the largest items the reader may see. Counted as stored, so these
      // are shares of the facts, not of the table's size on disk (its indexes and pages).
      const types = counted.bytes_by_type;
      const said = types.reduce((a, t) => a + t.bytes, 0);
      const row = (pid: string, title: string, n: number, list: string, item?: string) => part(id, { ...piece(pid, title, n), use: { as: 'row', list, used: n, shown: bytes(n), share: ratio(n, said), ...(item && { item }) } });
      for (const t of types.slice(0, TYPES)) row(`use:storage:type:${t.type}`, typeName(t.type), t.bytes, 'By type');
      const rest = types.slice(TYPES).reduce((a, t) => a + t.bytes, 0);
      if (rest) row('use:storage:type:rest', 'Every other type', rest, 'By type');
      const largest = counted.largest;
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
      // The sessions at work the reader may see, newest heard from first.
      const seen = await titlesOf(counted.awake);
      const rows = counted.awake.flatMap((s) => (seen.has(s) ? [seen.get(s)!] : []));
      for (const r of rows) part(id, piece(`use:sessions:${r.id}`, r.title, 1, r.id, 'At work'));
      if (used.sessions > rows.length) part(id, piece('use:sessions:hidden', 'Sessions you cannot see', used.sessions - rows.length, undefined, 'At work'));
    }

    if (name === 'requests' || name === 'looks') {
      const by = name === 'requests' ? counted.requests_by : counted.looks_by;
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
      const rows = (counted.members ?? []).map((person_id) => ({ person_id }));
      const people = await titlesOf(rows.map((r) => r.person_id));
      for (const r of rows) part(id, piece(`use:members:${r.person_id}`, people.get(r.person_id)?.title ?? 'A member', 1, people.has(r.person_id) ? r.person_id : undefined, 'By person'));
    }
  }

  return {
    as_of: new Date().toISOString(),
    near_at: counted.near,
    ...(limits?.note && { note: limits.note }),
    lens: { view: 'usage' },
    items,
    links,
  };
}
