// A document anyone may read, with no login, at an address of its own that search engines may keep:
// /p/<workspace>/<id>, beside a product's public page. Only a human makes it public: the core pack holds an agent's
// change to public, as for anything public. The address holds no secret and is not withdrawn
// by revoking anything: it reads while the document is public, and is a 404 once it is not.
//
// It is read through one function that sees everything and gives as little as it can (below): the document, and of
// the items its note brings in, those it holds (part_of it) with their notes, and those public in their own right with
// their names and states only. Nothing private (a section shows once it is shared with the workspace), nothing archived,
// nothing of another workspace. What it does not give is scrubbed from the text as a link's is.

import { forReader, sectionIds, type Given } from './documents.ts';
import type { Archipelago } from './pelago.ts';

// What the database gives of it is pelago_public_document (src/public-schema.ts).

const ID = /^e_[a-z0-9]{8}$/;

/**
 * The types a document is read whole as and can be public: a flavour that cannot be (an invoice) is left out.
 */
export const readable = (l: Archipelago) => l.registry.drawnWith('document').filter((t) => l.registry.type(t)?.public);

/** Of those, each closed status that says its writing is done (phase finished), as type:status: still published with the open ones. */
export const finishedStatuses = (l: Archipelago) =>
  readable(l).flatMap((t) => Object.entries(l.registry.type(t)?.statuses.phases ?? {}).filter(([, p]) => p === 'finished').map(([s]) => `${t}:${s}`));

/** A public document as anyone reads it, or null when there is no such public document. */
export async function publicDocument(l: Archipelago, id: string, elsewhere?: Map<string, string>) {
  if (!ID.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Given | null }>(`select pelago_public_document($1, $2::text[]) as doc`, [id, readable(l)]);
  const doc = rows[0]?.doc;
  return doc ? forReader(l, doc, undefined, elsewhere) : null;
}

/**
 * A document not yet public, as the public read above will give it once it is: for a preview of it before it is
 * published. The same rule, read as the one asking sees the map: of what its note brings in, what it holds with its
 * note, what is public in its own right by name and state, nothing private.
 */
export async function draftDocument(l: Archipelago, id: string, elsewhere?: Map<string, string>) {
  const doc = ID.test(id) ? await l.entity(id) : null;
  if (!doc || doc.archived_at || doc.private_to || !readable(l).includes(doc.type)) return null;
  const { rows } = await l.db.query<Given['items'][number] & { held: boolean; public: boolean }>(
    `select e.id, e.type, e.title, e.status, e.body, e.updated_at, exists (select 1 from picture p where p.entity_id = e.id) as picture,
            exists (select 1 from relation r where r.type = 'part_of' and r.valid_to is null and r.from_id = e.id and r.to_id = $2) as held,
            pelago_is_public(e.id) as public
     from entity e where e.id = any($1::text[]) and e.archived_at is null and e.private_to is null and e.visibility <> 'private' and e.workspace = $3`,
    [sectionIds(doc.body), doc.id, doc.workspace],
  );
  const items = rows.filter((r) => r.held || r.public).map(({ held, public: _, ...r }) => ({ ...r, body: held ? r.body : '' }));
  return forReader(l, { id: doc.id, type: doc.type, title: doc.title, body: doc.body, status: doc.status, props: doc.props, updated_at: String(doc.updated_at), items }, undefined, elsewhere);
}

/** The figure of one section a public document shows, or null. */
export async function publicDocumentPicture(l: Archipelago, id: string, section: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  if (!ID.test(id) || !ID.test(section)) return null;
  const { rows } = await l.forAnyone().db.query<{ content_type: string; data: string }>(
    `select content_type, encode(bytes, 'base64') as data from pelago_public_document_picture($1, $2::text[], $3)`,
    [id, readable(l), section],
  );
  return rows[0] ? { content_type: rows[0].content_type, bytes: Buffer.from(rows[0].data, 'base64') } : null;
}

/** What every public page and its data are sent with: never sniffed, never telling where a reader came from (src/reply.ts). */
export { GUARD } from './reply.ts';
/** A public page loads its own scripts and styles, talks only to this server, frames only the sandbox its pictures are drawn in, and is never framed. */
export const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** A published document's page, which this server's own page may also frame, to read it on the canvas (ui/reader-frame.js). */
export const READER_POLICY = POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
