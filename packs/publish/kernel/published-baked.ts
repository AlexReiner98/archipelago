// A layout kept on the map, baked as its document is published (task e_p6xkk2fg): the page that publishes runs each
// such drawing in its preview once, walled in, and sends what it painted (packs/walls/page/style-code.js, bakeCode); publishing writes
// it as an SVG (./baked.ts) kept with the document by its hash, and a reader is shown that file, with nothing running.
// A drawing baked from other code than the one frozen is not taken: the code is named by its hash.

import type { KernelContext } from '#pelago/kernel';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
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
export function withBaked<T extends Frozen>(frozen: T, sent: unknown): T {
  const baked = typeof sent === 'string' ? unpacked(sent) : sent;
  if (!baked || typeof baked !== 'object') return frozen;
  const svgs: Record<string, string> = {};
  const keep = (svg: string) => {
    if (svg.length > MOST_BYTES) throw new Error(`A baked drawing weighs at most ${MOST_BYTES / 1_000_000} MB: this one is ${(svg.length / 1_000_000).toFixed(1)} MB`);
    if (Object.keys(svgs).length >= MOST * 3) throw new Error(`A document keeps at most ${MOST} baked drawings`);
    const hash = createHash('sha256').update(svg).digest('hex');
    svgs[hash] = svg;
    return hash;
  };
  const lenses = Object.fromEntries(
    Object.entries(frozen.lenses ?? {}).map(([id, lens]) => {
      const drawing = lens.style?.drawing;
      const sent = (baked as Record<string, Sent | undefined>)[id];
      if (!drawing?.coded || !sent || sent.hash !== drawing.hash) return [id, lens];
      // A page's frame: each width its top, its margins between channels of water, and its foot, kept apart.
      if (Array.isArray(sent.page)) {
        const page = sent.page.slice(0, 4).map((w) => {
          const made = slotted(w.baking, w.light ?? undefined);
          const { top, period, foot } = framed(w, made.height);
          const svg = { top: keep(bakedSvg(made, { y0: 0, y1: top })), strip: keep(bakedSvg(made, { y0: top, y1: foot })), foot: keep(bakedSvg(made, { y0: foot, y1: made.height })) };
          return { width: made.width, height: made.height, top, period, foot, svg };
        });
        return [id, { ...lens, style: { ...lens.style, drawing: { ...drawing, baked: { page } } } }];
      }
      const made = slotted(sent.baking, sent.light ?? undefined);
      const hash = keep(bakedSvg(made));
      return [id, { ...lens, style: { ...lens.style, drawing: { ...drawing, baked: { hash, width: made.width, height: made.height } } } }];
    }),
  );
  return { ...frozen, lenses, ...(Object.keys(svgs).length && { svgs }) };
}

/** What the page sent gzipped (packBaked in packs/walls/page/style-code.js), opened: never past what an honest one holds. */
function unpacked(sent: string): unknown {
  try {
    return JSON.parse(gunzipSync(Buffer.from(sent, 'base64'), { maxOutputLength: MOST_UNPACKED }).toString('utf8'));
  } catch (err) {
    throw new Error(`What was baked could not be opened: ${(err as Error).message.slice(0, 200)}`);
  }
}
/** The most what was baked may hold, opened. */
const MOST_UNPACKED = 300_000_000;

/** What pages baked for their documents, kept until the publish that follows takes it, ten minutes at most. */
const kept = new Map<string, { sent: unknown; at: number }>();
const KEPT_FOR = 10 * 60 * 1000;
const ID = /^e_[a-z0-9]{8}$/;

/**
 * What the page baked before it publishes (surface.keep_baked, from the preview's route, as the person publishing): kept
 * in this process for the publish that follows, never on the map. It is opened and checked only as it is published.
 */
export function keepBaked(ctx: KernelContext, id: string, sent: unknown) {
  if (!ID.test(id)) throw new Error('A document is named by its id');
  if (typeof sent !== 'string' && (!sent || typeof sent !== 'object')) throw new Error('What was baked is gzipped JSON or an object');
  const now = Date.now();
  for (const [k, v] of kept) if (now - v.at > KEPT_FOR) kept.delete(k);
  kept.set(`${ctx.workspace}:${id}`, { sent, at: now });
  return { kept: id };
}

/** What a page baked for this document in the last ten minutes, taken: a publish uses it once. */
export function takeBaked(workspace: string, id: string): unknown {
  const key = `${workspace}:${id}`, was = kept.get(key);
  kept.delete(key);
  return was && Date.now() - was.at <= KEPT_FOR ? was.sent : undefined;
}

type Sent = { hash?: unknown; baking?: unknown; light?: unknown; page?: ({ baking?: unknown; light?: unknown } & Record<string, unknown>)[] };

/** Where a page's frame is cut: its top ends and its foot begins on a channel, whole periods of margin between them. */
function framed(w: Record<string, unknown>, height: number) {
  const [top, period, foot] = [w.top, w.period, w.foot].map(Number);
  if (![top, period, foot].every(Number.isFinite) || period < 40 || top <= 0 || foot <= top || foot >= height) throw new Error('A page frame has a top, a period and a foot inside it');
  const periods = (foot - top) / period;
  if (Math.abs(periods - Math.round(periods)) > 0.01) throw new Error('The margins of a page frame are whole periods long');
  return { top, period, foot };
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
