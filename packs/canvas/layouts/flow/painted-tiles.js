// Where a painted island's look paints, in the map's own world (task e_cr98zz2g: one scene, one renderer): each island
// is painted on a tile of the picture, a place in the picture's units with a density (`k`, CSS pixels a unit), and the
// page lays that tile under the marks with the plane's own camera (packs/walls/page/surface.js). So a pan never asks a
// look to paint again. A zoom does, at the screen's own density, so a look's words stay their own size (the owner, 19
// Nov 2026: text must not grow and shrink with the zoom); the browser scales the tile with the marks only for the
// frame or two until that paint comes. An island too big to paint whole is painted for what is in view and a margin
// round it, again only once the view leaves what it holds.
// Layer: metrics. Pure: an island's frame, the view and the tile it has in, a tile out.

/** What sums leave over, not a difference. */
const DUST = Number.EPSILON * 64;

/** Whether two densities are the same but for what sums leave over. */
const near = (a, b) => Math.abs(a - b) <= Math.max(a, b) * DUST;

const meet = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.width, b.x + b.width), t = Math.min(a.y + a.height, b.y + b.height);
  return r > x && t > y ? { x, y, width: r - x, height: t - y } : null;
};
const holds = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
const same = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * The tile island `isle` ({ at: [x, y], size: [w, h] }, in the picture's units) is painted on, seen through `view`
 * ({ x, y, width, height, scale }, scale the CSS pixels a unit) at `dpr`, given the tile it had (`was`, or null).
 * Answers { rect, k, step, whole }: the tile, `k` its density and `step` the one it would have unbounded; `was` itself
 * where nothing need change; null where the island is out of sight (with `margin` of the view round it). `most` is the
 * pixels a tile may hold and `side` the most across (the style's plane_tile_*); with none, it is painted whole.
 */
export function tileFor(isle, view, dpr, was, { most, side, margin }) {
  const frame = { x: isle.at[0], y: isle.at[1], width: isle.size[0], height: isle.size[1] }, pad = margin > 0 ? margin : 0;
  if (!view || !(view.width > 0) || !(view.height > 0) || !(frame.width > 0) || !(frame.height > 0)) return was;
  const wide = { x: view.x - view.width * pad, y: view.y - view.height * pad, width: view.width * (1 + 2 * pad), height: view.height * (1 + 2 * pad) };
  const seen = meet(frame, view), around = meet(frame, wide);
  if (!around) return null;
  const want = view.scale > 0 ? view.scale : 1;
  // The screen's own density: a pan keeps it, a zoom paints again.
  const k0 = was && near(was.step, want) ? was.step : want;
  const fits = (r, k) => !(r.width * r.height * (k * dpr) ** 2 > most) && !(Math.max(r.width, r.height) * k * dpr > side);
  if (fits(frame, k0)) return was?.whole && was.step === k0 && same(was.rect, frame) ? was : { rect: frame, k: k0, step: k0, whole: true };
  // Too big whole: what is in view and its margin, kept while it still holds all of the island in view.
  if (was && !was.whole && was.step === k0 && (!seen || holds(was.rect, seen))) return was;
  const k = Math.min(k0, Math.sqrt(most / (around.width * around.height)) / dpr, side / (Math.max(around.width, around.height) * dpr));
  return { rect: around, k, step: k0, whole: false };
}

/** What a look is told of its tile: its frame, and where that frame lands on the tile's canvas ({ k, tx, ty }). */
export const camOf = (isle, tile) => ({ width: isle.size[0], height: isle.size[1], k: tile.k, tx: (isle.at[0] - tile.rect.x) * tile.k, ty: (isle.at[1] - tile.rect.y) * tile.k });

/** The size of a tile's canvas, in CSS pixels, at `dpr`. */
export const sizeOf = (tile, dpr) => ({ width: tile.rect.width * tile.k, height: tile.rect.height * tile.k, dpr });
