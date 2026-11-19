// A type by its outline (round 6, screen e_vm8eg36x, pass 5: "more shape variation to let the types jump out"). Simple pieces,
// not mountains, except where they read: a chamfer (the top corners cut off), a point (a hexagon's ends), a round (a pill),
// a fold (a corner turned down), a tab (a folder's, over the left third) and a summit (the one outline that breaks out of its
// box). A type names its outline in the style (`type_shapes`, as it always has), so a pack gives its own type one. The status
// colour is drawn only in a piece of the outline: the cap under a skyline, the summit, the fold or the tab (`statusPiece`).
// Pass 5, the trail: every type but the aim is a trail marker and its status colour the blaze painted on it (a band along the top;
// the fold of the summit register; the roof of a hut). The signpost's point and the junction's are a flag's and a hexagon's, kept
// shallow by the style's sizes; the hut is a box under a shallow gable (`hut`).
// Layer: marks. Pure: a box and a piece in, a path out.

/** A box whose top corners are cut off by `k`. */
export const chamfer = (l, t, r, b, k) => `M${l + k} ${t}H${r - k}L${r} ${t + k}V${b}H${l}V${t + k}Z`;

/** A box with its top right corner turned down: the outline has the corner cut, the flap is a triangle of its own. */
export const fold = (l, t, r, b, k) => `M${l} ${t}H${r - k}L${r} ${t + k}V${b}H${l}ZM${r - k} ${t}V${t + k}H${r}`;
export const flap = (r, t, k) => `M${r - k} ${t}L${r} ${t + k}H${r - k}Z`;

/** The folder tab over the left third of a place's top: the strip the status colour fills, from the top down to the tab's foot. */
export const tabStrip = (l, t, w, k) => `M${l} ${t}H${l + w / 3}L${l + w / 3 + k} ${t + k}H${l}Z`;

/**
 * A box whose top edge has a peak rising out of it: `rise` above the edge, `span` of the width across its foot, in the middle
 * (a peak, straight sides, not a dome: pass 6). The node's top is the peak's: the box starts `rise` lower. Outline only: its
 * status colour is a band along the box's top like every other marker's.
 */
export function summit({ l, t, r, b, rise, span }) {
  const top = t + rise, mid = (l + r) / 2, half = ((r - l) * span) / 2;
  return { outline: `M${l} ${top}H${mid - half}L${mid} ${t}L${mid + half} ${top}H${r}V${b}H${l}Z`, top, mid, half };
}

/** A hut: a box under a shallow gable, kept within its top edge (the corners `rise` below the ridge). Outline only. */
export function hut({ l, t, r, b, rise }) {
  const mid = (l + r) / 2, top = t + rise;
  return { outline: `M${l} ${top}L${mid} ${t}L${r} ${top}V${b}H${l}Z` };
}

/** The outline a shape word draws, where it is one of this module's: `k` is the cut (a chamfer's, a fold's, a summit's rise). Else null. */
export function outlineOf(shape, l, t, r, b, k, { span, tension } = {}) {
  if (shape === 'chamfer') return chamfer(l, t, r, b, k);
  if (shape === 'fold') return fold(l, t, r, b, k);
  if (shape === 'hut') return hut({ l, t, r, b, rise: k }).outline;
  if (shape === 'summit') return summit({ l, t, r, b, rise: k, span: span ?? 0.4 }).outline;
  return null;
}

/**
 * A cap on the top edge between `l` and `r`, `d` deep, in a plain shape and not a skyline (pass 5, Alex: "most not obviously
 * mountains"): a flat band, a trapezoid (its lower ends chamfered), a point (a chevron) or a round arc. `rx` follows a rounded
 * box's own top corners. An unknown word is the band.
 */
export function cap(kind, l, r, t, d, rx = 0) {
  const mid = (l + r) / 2, w = r - l;
  if (kind === 'trapezoid') return `M${l} ${t}H${r}L${r - d} ${t + d}H${l + d}Z`;
  if (kind === 'point') return `M${l} ${t}H${r}V${t + d * 0.4}L${mid} ${t + d}L${l} ${t + d * 0.4}Z`;
  if (kind === 'arc') {
    const e = d * 0.3, s = d - e, radius = (w * w / 4 + s * s) / (2 * s);
    return `M${l} ${t}H${r}V${t + e}A${radius} ${radius} 0 0 1 ${l} ${t + e}Z`;
  }
  return rx ? `M${l} ${t + d}V${t + rx}A${rx} ${rx} 0 0 1 ${l + rx} ${t}H${r - rx}A${rx} ${rx} 0 0 1 ${r} ${t + rx}V${t + d}Z` : `M${l} ${t}H${r}V${t + d}H${l}Z`;
}

/**
 * The points of the one band of status paint along a marker's top, `d` deep, for every outline alike (pass 6): it follows the
 * outline's own edge, so a signpost's and a junction's points widen it, a fold's diagonal narrows it, a hut's roof bends it and a
 * summit's box carries it under the peak. `k` is the outline's cut (point, fold, roof or rise), `rx` a rounded box's corner.
 */
export function bandPoints(shape, { l, t, r, b, k = 0, d, rx = 0 }) {
  const h = b - t, slope = k && h ? (k * d) / (h / 2) : 0, mid = (l + r) / 2;
  if (shape === 'flag') return [[l, t], [r - k, t], [r - k + slope, t + d], [l, t + d]];
  if (shape === 'hexagon' || shape === 'lozenge') return [[l + k, t], [r - k, t], [r - k + slope, t + d], [l + k - slope, t + d]];
  if (shape === 'fold') return [[l, t], [r - k, t], [r - k + d, t + d], [l, t + d]];
  if (shape === 'hut') return [[l, t + k], [mid, t], [r, t + k], [r, t + k + d], [mid, t + d], [l, t + k + d]];
  if (shape === 'summit') return [[l, t + k], [r, t + k], [r, t + k + d], [l, t + k + d]];
  if (shape === 'pill') {
    // The round ends take the band's corners: its edge at depth `y` is where the end's circle is.
    const rad = h / 2, edge = (y) => rad - Math.sqrt(Math.max(0, rad * rad - (rad - y) ** 2));
    return [[l + edge(d), t + d], [l + edge(d / 2), t + d / 2], [l + rad, t], [r - rad, t], [r - edge(d / 2), t + d / 2], [r - edge(d), t + d]];
  }
  const c = Math.min(rx, d), o = 0.29 * c;
  return rx ? [[l, t + d], [l, t + c], [l + o, t + o], [l + c, t], [r - c, t], [r - o, t + o], [r, t + c], [r, t + d]] : [[l, t], [r, t], [r, t + d], [l, t + d]];
}

/** A band as a path. */
export const bandPath = (shape, box) => `M${bandPoints(shape, box).map((p) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`).join('L')}Z`;

/** The area of a polygon's points: what a band paints (the test holds every marker's within a share of the others'). */
export const areaOf = (pts) => Math.abs(pts.reduce((sum, p, i) => sum + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
