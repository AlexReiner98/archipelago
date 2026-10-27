// A document is writing for a reader, made of the map. Its note is the text, and a line holding only an item's id
// brings that item in at that place, as a section: so what the map says, the document says, with no copy to drift.
// Whoever may see a document may read it whole here; the owner can give someone with no login a link to it, and the
// link shows that document and the items it brings in, nothing else (pelago_shared_document in src/db.ts).

import { createHash, randomBytes } from 'node:crypto';
import { newId, type Q } from './db.ts';
import type { Actor, Archipelago } from './pelago.ts';

/** A line that brings an item in: its id and nothing else. */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/;

export interface Section {
  id: string;
  type: string;
  title: string;
  status: string;
  body: string;
  updated_at: string | Date;
  /** Whether a figure is kept for it, shown above its text. */
  picture?: boolean;
  /** Read through a share with this workspace: the item here that the share is, for its figure. */
  via?: string;
}

/** A document as its reader meets it: the text between sections, and each section in its place. */
export type Part = { text: string } | { section: Section } | { missing: string };

/** The ids a document's note brings in, in the order it brings them. */
export function sectionIds(body: string): string[] {
  return [...new Set(body.split('\n').flatMap((line) => SECTION.exec(line)?.[1] ?? []))];
}

/** Cut a note into its text and the places where items come in. An id that could not be read is said as missing. */
export function assemble(body: string, items: Map<string, Section>): Part[] {
  const parts: Part[] = [];
  let text: string[] = [];
  const flush = () => {
    const joined = text.join('\n').trim();
    if (joined) parts.push({ text: joined });
    text = [];
  };
  for (const line of body.split('\n')) {
    const id = SECTION.exec(line)?.[1];
    if (!id) {
      text.push(line);
      continue;
    }
    flush();
    const found = items.get(id);
    parts.push(found ? { section: found } : { missing: id });
  }
  flush();
  return parts;
}

/** The item a workspace holds a document another workspace shares with it as (src/workspace-share.ts). A kernel type. */
export const SHARED = 'shared_document';

/** Of an item's fields, those its type's pack marks as shown: what a page may lay out (an invoice's number, dates, total). */
export const shownOf = (l: Archipelago, type: string, props: Record<string, unknown>) => {
  const defs = l.registry.type(type)?.fields ?? {};
  return Object.fromEntries(Object.entries(props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
};

/** A document whole, as the one asking may see it. */
export async function readDocument(l: Archipelago, id: string) {
  const doc = await l.entity(id);
  if (!doc || !l.registry.drawnWith('document').includes(doc.type)) throw new Error(`"${id}" is not a document`);
  const items = new Map<string, Section>();
  const ids = sectionIds(doc.body);
  const pictured = new Set((await l.db.query<{ entity_id: string }>(`select entity_id from picture where entity_id = any($1::text[])`, [ids])).rows.map((r) => r.entity_id));
  for (const sid of ids) {
    const e = await l.entity(sid);
    if (e && !e.archived_at) items.set(sid, { id: e.id, type: e.type, title: e.title, status: e.status, body: e.body, updated_at: e.updated_at, picture: pictured.has(sid) });
  }
  // A section belongs inside its document. Those kept elsewhere are named, so whoever wrote them can move them in.
  const inside = new Set(
    (await l.db.query<{ from_id: string }>(`select from_id from relation where type = 'part_of' and valid_to is null and to_id = $1 and from_id = any($2::text[])`, [doc.id, ids])).rows.map((r) => r.from_id),
  );
  const notInside = [...items.keys()].filter((sid) => !inside.has(sid));
  return { id: doc.id, type: doc.type, title: doc.title, status: doc.status, for: doc.props.for ?? null, fields: shownOf(l, doc.type, doc.props), updated_at: doc.updated_at, parts: assemble(doc.body, items), ...(notInside.length && { not_inside: notInside }) };
}

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Where a link is read: a path on this server. */
export const sharePath = (workspace: string, secret: string) => `/s/${workspace}/${secret}`;

/** A link to a document for someone with no login. The secret is in the path it returns, shown once. */
export async function createShare(l: Archipelago, actor: Actor, id: string) {
  const doc = await l.entity(id);
  if (!doc || doc.type === SHARED || !l.registry.drawnWith('document').includes(doc.type)) throw new Error(`"${id}" is not a document of this workspace: only one can be given as a link.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  const secret = randomBytes(24).toString('hex');
  const share = newId('s');
  const by = actor.person ?? `${actor.kind}:${actor.name}`;
  await l.db.transaction(async (tx: Q) => {
    await tx.query(`insert into share (id, workspace, hash, hint, entity_id, made_by) values ($1, $2, $3, $4, $5, $6)`, [share, l.workspace, hash(secret), `…${secret.slice(-6)}`, id, by]);
    await l.log(tx, { actor: `${actor.kind}:${actor.name}`, action: 'share.create', target: id, reason: 'A link was made to read it with no login', detail: { share } });
  });
  return { share, path: sharePath(l.workspace, secret), note: 'Anyone with this link can read the document and what it brings in. Keep it now: it is not stored and cannot be shown again.' };
}

/** The links made to a document, standing first. */
export async function listShares(l: Archipelago, id: string) {
  const { rows } = await l.db.query<{ id: string; hint: string; made_by: string; created_at: Date; revoked_at: Date | null; to_workspace: string | null; publishable: boolean }>(
    `select id, hint, made_by, created_at, revoked_at, to_workspace, publishable from share where entity_id = $1 order by revoked_at is not null, created_at desc`,
    [id],
  );
  return rows;
}

/** Stop a link from working. */
export async function revokeShare(l: Archipelago, actor: Actor, share: string) {
  return l.db.transaction(async (tx: Q) => {
    const { rows } = await tx.query<{ entity_id: string; to_workspace: string | null; to_item: string | null }>(`update share set revoked_at = now() where id = $1 and revoked_at is null returning entity_id, to_workspace, to_item`, [share]);
    if (!rows.length) throw new Error(`No standing link "${share}"`);
    const [r] = rows;
    await l.log(tx, { actor: `${actor.kind}:${actor.name}`, action: 'share.revoke', target: r.entity_id, reason: r.to_workspace ? `It is no longer shared with the workspace "${r.to_workspace}"` : 'A link to read it was revoked', detail: { share } });
    return { revoked: share, document: r.entity_id, to_workspace: r.to_workspace, to_item: r.to_item };
  });
}

/** The figure of one item a link shows, read as anyone with no login, or nothing. */
export async function sharedPicture(l: Archipelago, secret: string, id: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  if (!/^[a-f0-9]{48}$/.test(secret) || !/^e_[a-z0-9]{8}$/.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ content_type: string; data: string }>(
    `select content_type, encode(bytes, 'base64') as data from pelago_shared_picture($1, $2)`,
    [hash(secret), id],
  );
  return rows[0] ? { content_type: rows[0].content_type, bytes: Buffer.from(rows[0].data, 'base64') } : null;
}

/** What a link shows, read as anyone with no login: the document and the items it brings in, or nothing. */
export async function sharedDocument(l: Archipelago, secret: string) {
  if (!/^[a-f0-9]{48}$/.test(secret)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Given | null }>(
    `select pelago_shared_document($1) as doc`,
    [hash(secret)],
  );
  const doc = rows[0]?.doc;
  return doc ? forReader(l, doc) : null;
}

/** A document read from outside the map, as the database gave it: the document and the items it brings in. */
export interface Given {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  props: Record<string, unknown>;
  updated_at: string;
  items: Section[];
}

/**
 * What a reader from outside the map is given of a document: an item it does not bring in is not named either, so
 * where a text points at one the reader is told less, not more. `via` marks each section as read through that share.
 */
export function forReader(l: Archipelago, doc: Given, via?: string, elsewhere: Map<string, string> = new Map()) {
  // Named as well as shown: other documents a reader can open where they are (a published one's pages), by title.
  const shown = new Set([...doc.items.map((item) => item.id), ...elsewhere.keys()]);
  const scrub = (text: string) => text.replace(/[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g, (found, id) => (shown.has(id) ? found : ''));
  const items = new Map(doc.items.map((item) => [item.id, { ...item, body: scrub(item.body), ...(via && { via }) }]));
  const parts = assemble(doc.body, items).flatMap((part): Part[] => ('missing' in part ? [] : 'text' in part ? [{ text: scrub(part.text) }] : [part]));
  const named = [...elsewhere].filter(([id]) => parts.some((part) => ('text' in part ? part.text : 'section' in part ? part.section.body : '').includes(id)));
  return { type: doc.type, title: doc.title, status: doc.status, fields: shownOf(l, doc.type, doc.props), updated_at: doc.updated_at, parts, ...(named.length && { links: Object.fromEntries(named) }) };
}
