// What was published, as a reader's page is given it (src/server-published.ts hands it to the reader pack): a
// document's data with each drawing's code left at the address it is fetched from by its hash, that code by its hash,
// and where a public item is read.

const HASH = /^[0-9a-f]{64}$/;

type Lens = { style?: { drawing?: { id: string; title: string; hash: string; modules?: Record<string, string> } } } & Record<string, unknown>;
type Doc = { title: string; /** Its parts, as src/documents.ts reads them: text, a section, or one missing. */ parts: unknown[]; lenses?: Record<string, Lens> } & Record<string, unknown>;

/** Where a public item's page is read: stable for as long as it is public, whatever it is renamed. */
export const publicPath = (workspace: string, id: string) => `/p/${workspace}/${id}`;

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
  // The look it was published in is sent as the page's own fields (src/styles.ts, pageLook), never twice.
  const { look: _look, ...rest } = doc as Doc & { look?: unknown };
  return { ...rest, ...(doc.lenses && { lenses }) };
}

/** The code of a drawing a published document's pictures are drawn by, by its hash, or null. */
export function layoutCode(doc: Doc, hash: string) {
  if (!HASH.test(hash)) return null;
  return Object.values(doc.lenses ?? {}).find((lens) => lens.style?.drawing?.hash === hash && lens.style.drawing.modules)?.style?.drawing?.modules ?? null;
}
