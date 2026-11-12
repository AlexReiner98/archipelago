// The reads the service packs still lacked once they moved (task e_szpyn5c2, docs/kernel-packs.md): one link by its
// id (placement), the log's head and a pack's own memory (automation), what is published and shared, a kept picture,
// a count stream and the privacy scrub (publish), the islands rules' verdict (placement's island start), and who
// corrected what after an agent (sessions' frontier). Each is bounded by the ids, key or limit it is given, and
// answered as the asker under row-level security, as every read of packreads.ts is.

import type { Archipelago } from '../../../src/pelago.ts';
import { headPos } from '../../log/kernel/tail.ts';
import { opEntries, type OpStream } from '../../log/kernel/streams.ts';
import { isCountStream } from '../../log/kernel/retention.ts';
import { publicViewAt, publicViews } from '../../database/kernel/public-view-store.ts';
import { draftDocument, publicDocument } from '../../walls/kernel/public-document.ts';
import { islandsOff } from './islands.ts';
import { LOCAL_PACK } from './packs.ts';

export type ServiceRead = {
  /** One open link by its id, or null: what an unlink takes away, read alone rather than every link of its kind. */
  link?: string;
  /** The fact stream's last position: the log's head, where a pass that read the map stands. */
  log_head?: true;
  /** The asking pack's own memory, one key of it kept in the workspace's settings: read, or with value written (null clears it). */
  memory?: { key: string; value?: unknown };
  /** What the island rules would switch off here (src/islands.ts), each pack with why, and the pack approved types go to. */
  islands_off?: true;
  /** Every public view, as anyone reads them: id, title as shared, path, place and when. */
  public_views?: true;
  /** The public view at an address word, as anyone reads it, or null. */
  public_view_at?: string;
  /** A document as the public read gives it (the privacy scrub), or, draft, as it will once published, read as the asker. */
  public_document?: { id: string; draft?: boolean };
  /** What was published of an item: what was given, by whom and when, or null. */
  published_row?: string;
  /** The views shared in public, newest first (at most 500), or the one of an item: by whom, when and at which path. */
  shared?: { id?: string };
  /** The picture kept for an item, as base64, or null. */
  picture?: string;
  /** The entries of a count stream after a position (at most COUNT_ENTRIES), each its position and facts: never a kernel stream. */
  counts?: { stream: string; after?: number };
  /** Of some items, the fields a person said after any agent last did (an item a person made counts whole), with who and when. */
  corrections?: string[];
};

/** The reads of this module, by name. */
const SERVICE_READS = ['link', 'log_head', 'memory', 'islands_off', 'public_views', 'public_view_at', 'public_document', 'published_row', 'shared', 'picture', 'counts', 'corrections'] as const satisfies readonly (keyof ServiceRead)[];
/** The most entries one read of a count stream answers. */
export const COUNT_ENTRIES = 1000;
/** A key of a pack's memory: a short word of letters, digits, _, -, : and . */
const KEY = /^[A-Za-z0-9_.:-]{1,120}$/;
const ID = /^e_[a-z0-9]{8}$/;

const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};
const loggedIn = (l: Archipelago, what: string) => {
  if (l.props !== 'props') throw new Error(`Anyone with no login reads no ${what}.`);
};

/** The settings key a pack's memory is kept under: its own, apart from the kernel's and every other pack's. */
export const memoryKey = (pack: string, key: string) => `pack:${pack}:${key}`;

/** The answer to one of these reads, or undefined when the read is none of them. `pack` is the pack asking, when one is. */
export async function serviceRead(l: Archipelago, q: ServiceRead, pack?: string): Promise<unknown> {
  const asked = SERVICE_READS.find((k) => q[k] !== undefined);
  if (!asked) return undefined;
  // The server's own packs alone: a sandboxed pack's reads are what packreads.ts answers, and no more.
  if (!pack) throw new Error(`Only the server's own packs read ${asked}`);
  if (q.link !== undefined) {
    if (typeof q.link !== 'string') throw new Error('link is the id of a link');
    if (l.props !== 'props') return null;
    const { rows } = await l.db.query(`select id, type, from_id, to_id, props, valid_from from relation where id = $1 and valid_to is null`, [q.link]);
    return rows[0] ?? null;
  }
  if (q.log_head) {
    loggedIn(l, 'log');
    return headPos(l.db);
  }
  if (q.memory !== undefined) {
    const key = String(q.memory.key);
    if (!KEY.test(key)) throw new Error('memory.key is a short word of letters, digits, _, -, : and .');
    const at = memoryKey(pack, key);
    if (!('value' in q.memory)) return (await l.setting(at)) ?? null;
    if (q.memory.value === null || q.memory.value === undefined) await l.db.query(`delete from setting where key = $1`, [at]);
    else await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [at, JSON.stringify(q.memory.value)]);
    return true;
  }
  if (q.islands_off) return { local: LOCAL_PACK, off: [...islandsOff(l.registry.packs, LOCAL_PACK)] };
  if (q.public_views) return publicViews(l);
  if (q.public_view_at !== undefined) return publicViewAt(l, String(q.public_view_at));
  if (q.public_document !== undefined) {
    const id = String(q.public_document.id);
    return q.public_document.draft ? draftDocument(l, id) : publicDocument(l, id);
  }
  if (q.published_row !== undefined) {
    loggedIn(l, 'publishing');
    const { rows } = await l.db.query(`select given, published_by, published_at from published where entity_id = $1`, [String(q.published_row)]);
    return rows[0] ?? null;
  }
  if (q.shared !== undefined) {
    loggedIn(l, 'sharing');
    const id = q.shared.id === undefined ? null : String(q.shared.id);
    const { rows } = await l.db.query(
      `select entity_id as id, given ->> 'title' as title, path, shared_by, shared_at from public_view where $1::text is null or entity_id = $1 order by shared_at desc limit 500`,
      [id],
    );
    return rows;
  }
  if (q.picture !== undefined) {
    const id = String(q.picture);
    if (!ID.test(id)) return null;
    const { rows } = await l.db.query<{ content_type: string; data: string; size: number }>(`select content_type, encode(bytes, 'base64') as data, size from picture where entity_id = $1`, [id]);
    return rows[0] ? { content_type: rows[0].content_type, size: rows[0].size, data: rows[0].data.replaceAll('\n', '') } : null;
  }
  if (q.counts !== undefined) {
    const stream = String(q.counts.stream);
    if (!isCountStream(stream)) throw new Error(`counts reads a count stream, not "${stream}"`);
    const after = Number(q.counts.after ?? 0);
    if (!(Number.isInteger(after) && after >= 0)) throw new Error('counts.after is a position, a whole number');
    const entries = await opEntries(l.db, stream as OpStream, { from: after + 1, limit: COUNT_ENTRIES });
    return entries.map((e) => ({ pos: e.pos, facts: e.facts }));
  }
  if (q.corrections !== undefined) {
    loggedIn(l, 'log');
    // Only the facts a person said after the last an agent (or anyone not a person) said of the item: the rest of each
    // item's history is weighed where it lies, not read back whole.
    const { rows } = await l.db.query<{ id: string; field: string; actor: string; at: Date; added: boolean }>(
      `with said as (
         select f.id, f.seq, f.field, e.head->'actor'->>'id' as actor, e.at from log_fact f join log_entry e on e.stream = f.stream and e.pos = f.pos and e.at = f.at
          where f.stream = 'facts' and f.id = any($1::text[]) -- index log_fact_history
       ), agent as (
         select id, max(seq) filter (where actor is null or actor not like 'human:%') as seq from said group by id
       )
       select s.id, s.field, s.actor, s.at, a.seq is null as added from said s join agent a on a.id = s.id
        where s.actor like 'human:%' and (a.seq is null or s.seq > a.seq) order by s.id, s.seq limit 20000`,
      [list(q.corrections, 'corrections')],
    );
    return rows;
  }
  return undefined;
}
