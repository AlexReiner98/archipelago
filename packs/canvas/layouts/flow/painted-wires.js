// What a painted island's look hands the map once it has settled (decisions e_jfctpqza, e_a6kbgg8c, the owner, 18 Nov
// 2026): each item's place, and how the lines on its island look. The map draws every line itself, at those places:
// the wires from other islands and the links among the island's own items, with the map's hover, heads and colours.
// This checks what a look hands and says what the marks become: each wire touching a placed item re-routed to it, from
// edge to edge, along the look's route for it where it gives one. Layer: metrics. Pure: what was handed in, patches out.

/** A finite number. */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
/** A point a look may give, [x, y], in its island's units. */
const point = (v) => (Array.isArray(v) && v.length >= 2 && num(v[0]) && num(v[1]) ? [v[0], v[1]] : null);
/** The widths a look may ask for its lines: the map's own wire, twice it, three times it. */
export const WIDTHS = ['thin', 'wide', 'bold'];

/** How a look may say its lines look: a width of WIDTHS, curve a bow -1 to 1, glow, dash numbers, opacity 0 to 1. */
function lineStyle(v) {
  if (!v || typeof v !== 'object') return {};
  const out = {};
  if (WIDTHS.includes(v.width)) out.width = v.width;
  if (num(v.curve)) out.curve = Math.max(-1, Math.min(1, v.curve));
  if (v.glow === true || v.glow === 1) out.glow = true;
  if (typeof v.dash === 'string' && /^\s*\d+(\.\d+)?(\s+\d+(\.\d+)?)*\s*$/.test(v.dash)) out.dash = v.dash.trim();
  if (num(v.opacity)) out.opacity = Math.max(0, Math.min(1, v.opacity));
  return out;
}

/**
 * What a look handed, checked: `said` { places: { id: [x, y, r?] }, lines?: style & { types?: { type: style } },
 * routes?: { 'from>to': [[x, y], ...] } }, in the island's units from its frame's top left, for the items of `own`
 * alone. Moved to the picture by the frame's corner `at`. Answers { places: Map(id → [x, y, r]), lines, types,
 * routes: Map(key → points) }, or null where it gives no place.
 */
export function handedOf(said, own, [ax, ay]) {
  if (!said || typeof said !== 'object' || !said.places || typeof said.places !== 'object') return null;
  const places = new Map();
  for (const [id, at] of Object.entries(said.places)) {
    const p = own.has(id) && point(at);
    if (p) places.set(id, [ax + p[0], ay + p[1], num(at[2]) && at[2] > 0 ? at[2] : 0]);
  }
  const routes = new Map();
  for (const [key, pts] of Object.entries(said.routes && typeof said.routes === 'object' ? said.routes : {})) {
    const line = Array.isArray(pts) ? pts.map(point) : [];
    if (/^[^>]+>[^>]+$/.test(key) && line.length && line.every(Boolean)) routes.set(key, line.map(([x, y]) => [ax + x, ay + y]));
  }
  const types = Object.fromEntries(Object.entries(said.lines?.types && typeof said.lines.types === 'object' ? said.lines.types : {}).map(([t, v]) => [t, lineStyle(v)]));
  return { places, lines: lineStyle(said.lines), types, routes };
}

/** Where the line from `c` toward `p` leaves a box `n` ({ w, h }) about it, or a circle of radius `r`. */
function exit([cx, cy], end, [px, py]) {
  const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy);
  if (!l) return [cx, cy];
  if (end.r !== undefined) return [cx + (dx / l) * end.r, cy + (dy / l) * end.r];
  const t = Math.min(dx ? end.w / 2 / Math.abs(dx) : Infinity, dy ? end.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** The control point of a bow from a to b, `k` of half its length out to one side. */
const bow = ([ax, ay], [bx, by], k) => [(ax + bx) / 2 - ((by - ay) * k) / 2, (ay + by) / 2 + ((bx - ax) * k) / 2];

/**
 * The line of a wire between ends `a` and `b` ({ at: [x, y], r } a placed item, { at, w, h } a box): edge to edge,
 * through `route` where the look gives one, else bowed by `curve`. Answers its points; a bow's are its ends and, between
 * them, its control point, with `bowed` set.
 */
export function lineOf(a, b, route, curve = 0) {
  const inner = route?.length ? route : curve ? [bow(a.at, b.at, curve)] : [];
  const points = [exit(a.at, a, inner[0] ?? b.at), ...inner, exit(b.at, b, inner.at(-1) ?? a.at)];
  return Object.assign(points, { bowed: !route?.length && Boolean(curve) });
}

/** A bowed line as a path: one curve through its control point. */
const curved = ([s, c, e]) => `M${s.join(' ')}Q${c.join(' ')} ${e.join(' ')}`;

/**
 * The patches that put every wire touching what was just placed where it now ends. `wires` [{ key, head, w, type }]: each
 * drawn wire's keys, its model (a, b, its points), its link type; `boxes` Map(id → { w, h, at }) where every other item
 * stands; `placed` Map(id → [x, y, r]) every item a look has placed so far; `painted` the ids a look draws (one not yet
 * placed keeps its wires hidden); `changed` the ids just placed; `styleOf(w, type)` the look's style for that wire, `routeOf(w)` its route for that wire;
 * `draw(w)` and `heads(w, type)` the map's own path and heads for a wire; `over` how long the move takes (0 at first).
 */
export function wirePatches({ wires, boxes, placed, painted, changed, styleOf, routeOf = () => null, draw, heads, over = 0 }) {
  const end = (id) => (placed.has(id) ? { at: placed.get(id).slice(0, 2), r: placed.get(id)[2] } : painted.has(id) ? null : boxes.get(id) ?? null);
  return wires.flatMap(({ key, head, w, type }) => {
    if (!changed.has(w.a) && !changed.has(w.b)) return [];
    const a = end(w.a), b = end(w.b);
    if (!a || !b) return [];
    const s = styleOf(w, type), points = lineOf(a, b, routeOf(w), s.curve ?? 0), moved = { ...w, points: [...points], gaps: [] };
    const looks = { unplaced: false, glow: Boolean(s.glow), ...Object.fromEntries(WIDTHS.map((k) => [`lw-${k}`, s.width === k])) };
    const set = { d: points.bowed ? curved(points) : draw(moved), 'stroke-dasharray': s.dash ?? null, 'stroke-opacity': s.opacity ?? null };
    const tip = head && heads(moved, type);
    return [{ key, set, toggle: looks, ...(over && { over }) }, ...(head ? [{ key: head, set: { d: tip || '' }, toggle: { unplaced: !tip }, ...(over && { over }) }] : [])];
  });
}

/** A route the look handed for a wire from a to b, the right way round: kept by its link's direction, from>to. */
export function routeFor(routes, a, b) {
  if (routes.has(`${a}>${b}`)) return routes.get(`${a}>${b}`);
  return routes.has(`${b}>${a}`) ? [...routes.get(`${b}>${a}`)].reverse() : null;
}
