// What a server pack may read of what a person published (task e_uc8m8jwa): a document as it was last published, the
// one at a site's path, its pictures and drawings, a site's pages. Each act goes through the security-definer reads
// alone (src/public-schema.ts, by way of src/published.ts), as anyone: the pack is handed only what is public, never
// the map. Publishing and taking down stay the kernel's (src/published.ts).
//
// Every answer is JSON: a document as its page's /data gives it (packs/reader), its look beside it and each
// drawing's code left at its hash; a picture's bytes as base64 with their content type. What is not published, or not
// there, is null, so a pack cannot tell a private item from one that never was.

import type { Part } from './documents.ts';
import { layoutCode, pageData, publicPath } from './published-data.ts';
import { PATH, publishedAt, publishedDocument, publishedPicture, sitePages } from './published.ts';
import type { ActPlaces } from './server-acts.ts';
import type { ServerAct, ServerPackFile } from './server-packs.ts';
import { pageLook } from './styles.ts';

const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID = /^e_[a-z0-9]{8}$/;
const HASH = /^[0-9a-f]{64}$/;

type Doc = { title: string; parts: Part[] } & Record<string, unknown>;

const word = (v: unknown, shape: RegExp, what: string) => {
  if (typeof v !== 'string' || !shape.test(v)) throw new Error(`${what} is needed, as ${String(shape)}.`);
  return v;
};

/** The workspace's map, read only through its public functions; null when there is no such workspace. */
async function mapOf(at: ActPlaces, input: Record<string, unknown>) {
  const id = word(input.workspace, WORKSPACE, 'A workspace');
  return (await at.has(id)) ? (await at.get(id)).pelago : null;
}

/** Do one of the published acts for a pack that declared it. Answers JSON, or null for what is not published. */
export async function publishedAct(at: ActPlaces, pack: ServerPackFile, act: ServerAct, input: Record<string, unknown>): Promise<unknown> {
  if (!(pack.reach.server.acts ?? []).includes(act)) throw new Error(`The pack "${pack.id}" did not declare the act "${act}".`);
  const l = await mapOf(at, input);
  const workspace = input.workspace as string;
  switch (act) {
    case 'published.read':
    case 'published.at': {
      const key = act === 'published.read' ? word(input.id, ID, 'An id') : word(input.path, PATH, 'A path');
      const doc = l && ((act === 'published.read' ? await publishedDocument(l, key) : await publishedAt(l, key)) as Doc | null);
      if (!l || !doc) return null;
      const id = act === 'published.read' ? (input.id as string) : String(doc.id);
      return pageData({ ...doc, id, ...(await pageLook(l, { ...doc, id })) }, publicPath(workspace, id));
    }
    case 'published.picture': {
      const id = word(input.id, ID, 'An id');
      const section = word(input.section, ID, 'A section');
      const picture = l && (await publishedPicture(l, id, section));
      return picture ? { content_type: picture.content_type, base64: picture.bytes.toString('base64') } : null;
    }
    case 'published.drawing': {
      const id = word(input.id, ID, 'An id');
      const hash = word(input.hash, HASH, 'A hash');
      const doc = l && ((await publishedDocument(l, id)) as Doc | null);
      return (doc && layoutCode(doc, hash)) ?? null;
    }
    case 'site.pages':
      return l ? sitePages(l) : [];
    default:
      throw new Error(`The act "${act}" is not one of the published acts.`);
  }
}
