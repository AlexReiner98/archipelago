// A link to a view or an item, frozen (decision e_qpaqnmrc, axes B and C): sharing it keeps the view's answer as it
// is at that moment, on the link itself (share.snapshot), as publishing freezes a picture. What it keeps is only what
// the view showed that is not private, and of each of those the head, the fields its type shows and its note; never
// who is looking, sessions, reasons or anything a part names that the link does not show.
//
// Opening the link trades its secret for a reader token (READER_MINUTES), so the secret is sent once and never on a
// call after. The token reads the snapshot and nothing else: the database answers it only through
// pelago_link_read, while the token is good and the link stands, so revoking the link ends every token out at once.
// It may call only the reads the app draws a canvas and an item's sheet with (LINK_READS), each answered from the
// snapshot. There is no live feed: a change made after sharing is not in it.

import { sectionIds, shownOf } from './documents.ts';
import { sha256Hex, workspaceSecret } from './hashes.ts';
import type { Archipelago } from './pelago.ts';
import { flatRead } from './query-flat.ts';
import { isKept, keptPicture } from './query-saved.ts';
import { pageStyle } from './styles.ts';
import { keep } from './transient.ts';

/** How long a reader token reads for. The page trades the link's secret again for another when it runs out. */
export const READER_MINUTES = 30;

/** What a reader token may call through /api, as the page names it, and which views of `view`. */
export const LINK_READS = new Set(['view', 'get', 'schema']);
export const LINK_VIEWS = new Set(['flat', 'style']);

const READER = /^link_([a-z0-9][a-z0-9-]{0,39})_[0-9a-f]{40}$/;
const IDS = /[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g;
const hash = sha256Hex;

/** The workspace a reader token is for, when the token is one. Says nothing about whether it is good. */
export const readerWorkspace = (token: string | undefined) => (token ? READER.exec(token)?.[1] : undefined);

type Props = Record<string, unknown>;
type Flat = Awaited<ReturnType<typeof flatRead>>;
type FlatItem = Flat['items'][number];
type FlatLink = Flat['links'][number];

/** One item as the link's sheet reads it: what get answers, of the snapshot alone. */
interface Page {
  entity: { id: string; type: string; title: string; body: string; status: string; is_open: boolean; visibility: string; props: Props; created_at: string; updated_at: string; archived_at: null };
  trail: never[];
  mentioned_in: never[];
  shown_in: never[];
  outgoing: Tie[];
  incoming: Tie[];
}
interface Tie { relation: string; type: string; props: Props; confidence: number; id: string; entity_type: string; title: string; status: string }

/** What a link keeps: when, of what, the answer the canvas draws, the style it is drawn in, and each item's page. */
export interface Snapshot {
  at: string;
  of: string;
  flat: Omit<Flat, 'items'> & { items: Omit<FlatItem, 'owner'>[] };
  style: Props;
  pages: Record<string, Page>;
}

/**
 * The snapshot of what a link to `id` shows, read as the one sharing it sees it, then cut to what is not private: a
 * view's answer, or an item alone (with the items its note brings in, as a document's). The item shared is kept
 * whatever its visibility, since sharing it is choosing that; what it shows is kept only when shared or public.
 */
export async function freeze(l: Archipelago, id: string): Promise<Snapshot> {
  const root = await l.entity(id);
  if (!root || root.archived_at) throw new Error(`"${id}" is not an item of this workspace you can read`);
  const view = isKept(l, root.type);
  const answer: Flat = view
    ? await (async () => { const { style: _style, ...rest } = await keptPicture(l, id); return rest as Flat; })()
    : await flatRead(l, { filter: { find: [id, ...sectionIds(root.body ?? '')].map((x) => `id ${x}`) }, limit: 200 });
  const ids = [...new Set([id, ...answer.items.map((i) => i.id)])];
  const { rows } = await l.db.query<{ id: string; type: string; title: string; body: string; status: string; is_open: boolean; visibility: string; props: Props; created_at: Date; updated_at: Date }>(
    `select id, type, title, body, status, is_open, visibility, props, created_at, updated_at from entity
     where id = any($1::text[]) and archived_at is null and (id = $2 or (visibility <> 'private' and private_to is null))`,
    [ids, id],
  );
  const row = new Map(rows.map((r) => [r.id, r]));
  const shown = new Set(row.keys());
  const scrub = (text: string) => text.replace(IDS, (found, ref) => (shown.has(ref) ? found : ''));
  const links = answer.links.filter((k: FlatLink) => shown.has(k.from) && shown.has(k.to));
  const items = answer.items
    .filter((i) => shown.has(i.id))
    .map(({ owner, session: _s, reasons: _r, ...item }: FlatItem & { session?: unknown; reasons?: unknown }) => ({ ...item, ...(item.body && { body: scrub(item.body) }), ...(owner && shown.has(owner) && { owner }) }));
  // A view's own item is drawn by the canvas from its page, not its answer; an item shared alone is in its answer.
  const titled = (to: string) => row.get(to)!;
  const tie = (k: FlatLink, other: string): Tie => ({ relation: k.id, type: k.type, props: (k.props ?? {}) as Props, confidence: 1, id: other, entity_type: titled(other).type, title: titled(other).title, status: titled(other).status });
  const pages: Record<string, Page> = {};
  for (const r of rows) {
    pages[r.id] = {
      // The view shared keeps its query and look whole (its page is how the canvas reads it); any other item its shown fields.
      entity: { id: r.id, type: r.type, title: r.title, body: scrub(r.body ?? ''), status: r.status, is_open: r.is_open, visibility: r.visibility, props: r.id === id && view ? r.props : shownOf(l, r.type, r.props), created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(), archived_at: null },
      trail: [], mentioned_in: [], shown_in: [],
      outgoing: links.filter((k) => k.from === r.id).map((k) => tie(k, k.to)),
      incoming: links.filter((k) => k.to === r.id).map((k) => tie(k, k.from)),
    };
  }
  // Islands named only where the link shows them, and without their findings.
  const islands = (answer as { islands?: { id: string; title?: string; pack?: unknown }[] }).islands?.filter((i) => shown.has(i.id)).map(({ id: isle, title, pack }) => ({ id: isle, title, pack }));
  const { viewer: _viewer, islands: _islands, items: _items, links: _links, ...rest } = answer as Flat & { viewer?: string; islands?: unknown };
  // The look the canvas is drawn in, as the workspace has it and not the sharer's own, with the drawing its shape names.
  const { style } = await pageStyle(l, { of: id, ...(view && { view: id }), have: [] }, false);
  return { at: new Date().toISOString(), of: id, flat: { ...rest, items, links, ...(islands?.length && { islands }) } as Snapshot['flat'], style, pages };
}

/**
 * A reader token for a link's secret, or nothing when no standing link has it (or it was made before links were
 * frozen). Read with the whole database: a token is made here, never by the reader.
 */
export async function trade(l: Archipelago, secret: string): Promise<{ token: string; expires_in: number } | null> {
  if (!/^[a-f0-9]{48}$/.test(secret)) return null;
  const { rows } = await l.db.query<{ id: string }>(`select id from share where hash = $1 and revoked_at is null and snapshot is not null`, [hash(secret)]);
  if (!rows[0]) return null;
  const token = workspaceSecret('link', l.workspace);
  await keep(l.db, `linkreader:${hash(token)}`, { share: rows[0].id }, READER_MINUTES * 60_000);
  return { token, expires_in: READER_MINUTES * 60 };
}

/** The snapshot a reader token reads, through the one function the database answers it with: null once it is not good. */
export async function snapshotFor(l: Archipelago, token: string): Promise<Snapshot | null> {
  if (readerWorkspace(token) !== l.workspace) return null;
  const { rows } = await l.forAnyone().db.query<{ snap: Snapshot | null }>(`select pelago_link_read($1) as snap`, [hash(token)]);
  return rows[0]?.snap ?? null;
}

/** Refused, with the status a reply gives it. */
export class LinkRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A call the page makes with a reader token, answered from the snapshot alone. Anything else is refused. */
export async function readLink(l: Archipelago, token: string, name: string, input: Props): Promise<unknown> {
  const snap = await snapshotFor(l, token);
  if (!snap) throw new LinkRefused(401, 'This link has been revoked, or its reader token has run out: open the link again.');
  if (!LINK_READS.has(name)) throw new LinkRefused(403, `A link only reads what it shows; it does not call ${name}.`);
  if (name === 'schema') return l.registry.describe();
  if (name === 'get') {
    const page = typeof input.id === 'string' ? snap.pages[input.id] : undefined;
    if (!page) throw new LinkRefused(404, 'This link does not show that item.');
    return page;
  }
  const view = typeof input.name === 'string' ? input.name : '';
  if (!LINK_VIEWS.has(view)) throw new LinkRefused(403, `A link only reads what it shows; it does not read the view ${view || '(none named)'}.`);
  if (view === 'style') return { style: snap.style };
  // Whatever query is asked, the answer is the one frozen: a link cannot be widened by asking for more.
  const whole = (input.params as Props | undefined)?.notes === 'whole';
  return whole ? { ...snap.flat, items: snap.flat.items.map((i) => ({ ...i, body: snap.pages[i.id]?.entity.body ?? i.body })), whole: snap.flat.items.map((i) => i.id) } : snap.flat;
}
