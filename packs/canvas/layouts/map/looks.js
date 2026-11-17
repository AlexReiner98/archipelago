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
