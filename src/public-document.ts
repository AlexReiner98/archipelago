// A document anyone may read, with no login, at an address of its own that search engines may keep:
// /p/<workspace>/<id>, beside a product's public page. Only a human makes it public: the core pack holds an agent's
// change to public, as for anything public. Unlike a link (/s/...), the address holds no secret and is not withdrawn
// by revoking anything: it reads while the document is public, and is a 404 once it is not.
//
// It is read through one function that sees everything and gives as little as it can (below): the document, and of
// the items its note brings in, those it holds (part_of it) with their notes, and those public in their own right with
// their names and states only. Nothing private (a section shows once it is shared with the workspace), nothing archived,
// nothing of another workspace. What it does not give is scrubbed from the text as a link's is.

import { forReader, SHARED, type Given, type Part } from './documents.ts';
import type { Archipelago } from './pelago.ts';

// What the database gives of it is pelago_public_document (src/public-schema.ts).

const ID = /^e_[a-z0-9]{8}$/;

/** The types a document is read whole as and can be public: a flavour that cannot be (an invoice) is left out. */
export const readable = (l: Archipelago) => l.registry.drawnWith('document').filter((t) => t !== SHARED && l.registry.type(t)?.public);

/** A public document as anyone reads it, or null when there is no such public document. */
export async function publicDocument(l: Archipelago, id: string, elsewhere?: Map<string, string>) {
  if (!ID.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Given | null }>(`select pelago_public_document($1, $2::text[]) as doc`, [id, readable(l)]);
  const doc = rows[0]?.doc;
  return doc ? forReader(l, doc, undefined, elsewhere) : null;
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

/** What a search engine shows under the title: the first paragraph the document opens on, as plain words, cut short. */
export function describe(parts: Part[], most = 160): string {
  for (const part of parts) {
    const text = 'text' in part ? part.text : 'section' in part ? part.section.body : '';
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.split('\n').map((line) => line.trim()).filter((line) => line && !/^#/.test(line) && !/^\|/.test(line));
      // A short line on its own above a paragraph is that paragraph's title (as ui/doc.js draws it).
      if (lines.length > 1 && lines[0].length <= 90 && !/[.;,:!?]$/.test(lines[0]) && !/^(-|\*|\d+\.)\s/.test(lines[0])) lines.shift();
      const words = lines
        .map((line) => line.replace(/^(-|\*|\d+\.)\s+/, ''))
        .join(' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
      if (!words) continue;
      if (words.length <= most) return words;
      const cut = words.slice(0, most - 1);
      return `${cut.slice(0, cut.lastIndexOf(' ') > most / 2 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s.,;:]+$/, '')}…`;
    }
  }
  return '';
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The shared document page (ui/doc.html) as a public document's: its own title, a description from its first
 * paragraph and the address to keep, and no request to be left out of a search engine's index.
 */
export function publicHead(html: string, doc: { title: string; parts: Part[] }, canonical: string): string {
  const description = describe(doc.parts);
  const head = [description && `<meta name="description" content="${escape(description)}" />`, `<link rel="canonical" href="${escape(canonical)}" />`].filter(Boolean).join('\n    ');
  return html.replace(/<meta name="robots" content="noindex" \/>/, head).replace(/<title>[^<]*<\/title>/, `<title>${escape(doc.title)}</title>`);
}
