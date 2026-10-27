// A published document's page as it is sent: the shared document page (ui/doc.html) with its head for search engines
// (src/public-document.ts) and its modules asked for at once (src/ui-files.ts), and its data in the page itself, so
// the page draws its text and its pictures' first frames as soon as its scripts are here. What a picture's
// drawing runs is not in the data: it is fetched by its hash, kept by the browser, while the first frame is on screen.

import type { Part } from './documents.ts';
import { publicHead } from './public-document.ts';
import { uiPage } from './ui-files.ts';

const HASH = /^[0-9a-f]{64}$/;

type Lens = { style?: { drawing?: { id: string; title: string; hash: string; modules?: Record<string, string> } } } & Record<string, unknown>;
type Doc = { title: string; parts: Part[]; lenses?: Record<string, Lens> } & Record<string, unknown>;

/** The section a page's style names for its link picture (page.share), when the page holds it with a figure. */
export const shareOf = (doc: { parts: Part[] }, share: unknown) =>
  typeof share === 'string' && doc.parts.some((p) => 'section' in p && p.section.id === share && p.section.picture) ? share : undefined;

/** Where a page's section's figure is read, below the page's own address. */
export const pictureAt = (page: string, section: string) => `${page.replace(/\/$/, '')}/picture/${section}`;

/** The data a published page draws from, with each drawing's code left at the address it is fetched from by its hash. */
export function pageData(doc: Doc, here: string) {
  const lenses = Object.fromEntries(
    Object.entries(doc.lenses ?? {}).map(([id, lens]) => {
      const drawing = lens.style?.drawing;
      if (!drawing?.modules) return [id, lens];
      const { modules: _code, ...named } = drawing;
      return [id, { ...lens, style: { ...lens.style, drawing: { ...named, src: `${here.replace(/\/$/, '')}/drawing/${drawing.hash}` } } }];
    }),
  );
  return { ...doc, ...(doc.lenses && { lenses }) };
}

/** The code of a drawing a published document's pictures are drawn by, by its hash, or null. */
export function drawingCode(doc: Doc, hash: string) {
  if (!HASH.test(hash)) return null;
  return Object.values(doc.lenses ?? {}).find((lens) => lens.style?.drawing?.hash === hash && lens.style.drawing.modules)?.style?.drawing?.modules ?? null;
}

/** JSON as it may stand inside a page's script element: nothing in it can close the element or open a comment. */
const inPage = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** The page sent for a published document: its head, its files named as ui-files.ts names them, its data in it, after
 * its script so the browser asks for the script first. `data` is what /data answers. */
export async function publishedPage(doc: Doc, canonical: string, site: string | undefined, data: unknown, image?: string) {
  const html = publicHead(await uiPage('doc.html'), doc, canonical, site, image);
  // Put in by functions, so nothing in the data is read as a replacement pattern ($&, $').
  return html
    .replace(/<main id="main">[\s\S]*?<\/main>/, () => '<main id="main"></main>')
    .replace('</body>', () => `<script type="application/json" id="page-data">${inPage(data)}</script></body>`);
}
