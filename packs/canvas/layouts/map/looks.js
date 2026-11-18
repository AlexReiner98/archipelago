// An island drawn by its own look (feature e_6efhubbz; decisions e_3c3wr7jv, e_r4emvndv, the owner, 17 Nov 2026: place
// and paint). A look is code kept on the map that draws an island (a layout linked draws to it, its index.js exporting `island`), handed by the
// frame to the map's drawing as `tools.looks`, by island id. It is asked once per picture with what that island holds
// and answers where each item stands and what to paint: the map keeps the frame's place, the header and its toggles,
// ghosts and held badges, each item's link and the wires between islands. A look that throws or answers nothing usable
// is left out, and the island is drawn as any other. Layer: metrics. Pure: the look's module and the island in, places out.

/** A number a look may give: finite and not below nothing. */
const size = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** A point a look may give: two finite numbers. */
const point = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? v : null);
/** A list of marks a look may give: the page checks each, as every scene's (packs/walls/page/marks.js). */
const marks = (v) => (Array.isArray(v) ? v.filter((k) => Array.isArray(k) && typeof k[0] === 'string') : []);

/**
 * What a look answers for one island: `look` its module, `island` the answer's island (id, title, pack), `nodes` the
 * boxes it holds (id, w, h, item), `links` those among them, `sizes` and `numbers` the style's, `measure` and `m` the
 * drawing's tools. Answers { width, height, places: Map(id → [x, y]), paint, items: Map(id → marks) }, every place a
 * box's middle measured from the island's top left under its header, or null where the look gives nothing to draw by.
 */
export function lookOut(look, { island, nodes, links, sizes, numbers, measure, m }) {
  if (typeof look?.island !== 'function') return null;
  let said;
  try {
    said = look.island({ island, items: nodes.map((n) => ({ ...n.item, box: [n.w, n.h] })), links, style: { sizes, numbers } }, { measure, m });
  } catch {
    return null;
  }
  const width = size(said?.width), height = size(said?.height);
  if (width === null || height === null) return null;
  const own = new Set(nodes.map((n) => n.id));
  const places = new Map(Object.entries(said.places ?? {}).filter(([id, at]) => own.has(id) && point(at)));
  const items = new Map(Object.entries(said.items ?? {}).filter(([id]) => own.has(id)).map(([id, v]) => [id, marks(v)]));
  return { width, height, places, paint: marks(said.paint), items };
}

/** Whether a look paints its island on a canvas (a layout's code: its default draws on one) rather than placing marks. */
export const paints = (look) => typeof look?.default === 'function' && typeof look?.island !== 'function';

/**
 * The shape a look that paints says it draws once laid out (its `frame({ answer, style })`, asked with what its island
 * holds and its settings, as `default` is given them): { width, height } in the island's units, or { aspect } (width
 * over height) alone. Answers the one it says, or null where it says nothing usable (or has no `frame`).
 */
export function frameOut(look, { island, nodes, links }) {
  if (typeof look?.frame !== 'function') return null;
  let said;
  try {
    said = look.frame({ answer: { items: nodes.map((n) => n.item), links: links ?? [], islands: island ? [island] : [] }, style: look.settings ?? {} });
  } catch {
    return null;
  }
  const width = size(said?.width), height = size(said?.height), aspect = size(said?.aspect);
  if (width && height) return { width, height };
  return aspect ? { aspect } : null;
}

/**
 * The frame [w, h] of an island whose look paints: `block` [w, h] what its items would take standing in a block, `said`
 * what its look says (frameOut), held within the style's bounds: an aspect no further from square than
 * flow_look_aspect_most, an area from flow_look_area_least to flow_look_area_most times the block's. A look that says
 * only an aspect keeps the block's area; one that says nothing, the block.
 */
export function framed([bw, bh], said, sizes) {
  if (!said || !(bw > 0 && bh > 0)) return [bw, bh];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), most = sizes.flow_look_aspect_most, area = bw * bh;
  const aspect = clamp(said.aspect ?? said.width / said.height, 1 / most, most);
  const a = clamp(said.width ? said.width * said.height : area, area * sizes.flow_look_area_least, area * sizes.flow_look_area_most);
  return [Math.sqrt(a * aspect), Math.sqrt(a / aspect)];
}
