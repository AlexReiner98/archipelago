// A layout kept on the map, baked as its document is published (task e_p6xkk2fg): the page that publishes runs each
// such drawing in its preview once, walled in, and sends what it painted (packs/walls/page/style-code.js, bakeCode); publishing writes
// it as an SVG (./baked.ts) kept with the document by its hash, and a reader is shown that file, with nothing running.
// A drawing baked from other code than the one frozen is not taken: the code is named by its hash.

import { createHash } from 'node:crypto';
import { bakedSvg, slotted } from './baked.ts';

type Drawing = { hash?: string; coded?: boolean; modules?: Record<string, string>; baked?: unknown } & Record<string, unknown>;
type Lens = { style?: { drawing?: Drawing } & Record<string, unknown> } & Record<string, unknown>;
type Frozen = { lenses?: Record<string, Lens> } & Record<string, unknown>;

/** The most baked SVGs one document keeps, and the most one may weigh. */
const MOST = 8;
const MOST_BYTES = 4_000_000;

/**
 * The document as it is published, with each drawing the page baked made its SVG: kept by the SVG's hash beside the
 * document (`svgs`), the drawing naming it (`baked`). One baked from other code than was frozen is left to run.
 */
export function withBaked<T extends Frozen>(frozen: T, baked: unknown): T {
  if (!baked || typeof baked !== 'object') return frozen;
  const svgs: Record<string, string> = {};
  const lenses = Object.fromEntries(
    Object.entries(frozen.lenses ?? {}).map(([id, lens]) => {
      const drawing = lens.style?.drawing;
      const sent = (baked as Record<string, { hash?: unknown; baking?: unknown; light?: unknown } | undefined>)[id];
      if (!drawing?.coded || !sent || sent.hash !== drawing.hash) return [id, lens];
      if (Object.keys(svgs).length >= MOST) throw new Error(`A document keeps at most ${MOST} baked drawings`);
      const made = slotted(sent.baking, sent.light ?? undefined);
      const svg = bakedSvg(made);
      if (svg.length > MOST_BYTES) throw new Error(`A baked drawing weighs at most ${MOST_BYTES / 1_000_000} MB: this one is ${(svg.length / 1_000_000).toFixed(1)} MB`);
      const hash = createHash('sha256').update(svg).digest('hex');
      svgs[hash] = svg;
      return [id, { ...lens, style: { ...lens.style, drawing: { ...drawing, baked: { hash, width: made.width, height: made.height } } } }];
    }),
  );
  return { ...frozen, lenses, ...(Object.keys(svgs).length && { svgs }) };
}

/** A published document as its draft would freeze it: without what was baked, which a draft never has. */
export function unbaked<T extends Frozen>(given: T): T {
  const { svgs: _svgs, ...rest } = given as T & { svgs?: unknown };
  const lenses = Object.fromEntries(
    Object.entries(given.lenses ?? {}).map(([id, lens]) => {
      const drawing = lens.style?.drawing;
      if (!drawing?.baked) return [id, lens];
      const { baked: _baked, ...kept } = drawing;
      return [id, { ...lens, style: { ...lens.style, drawing: kept } }];
    }),
  );
  return { ...rest, ...(given.lenses && { lenses }) } as T;
}
