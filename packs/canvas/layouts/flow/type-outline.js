// A type by its outline (round 6, screen e_vm8eg36x, pass 5: "more shape variation to let the types jump out"). Simple pieces,
// not mountains, except where they read: a chamfer (the top corners cut off), a point (a hexagon's ends), a round (a pill),
// a fold (a corner turned down), a tab (a folder's, over the left third) and a summit (the one outline that breaks out of its
// box). A type names its outline in the style (`type_shapes`, as it always has), so a pack gives its own type one. The status
// colour is drawn only in a piece of the outline: the cap under a skyline, the summit, the fold or the tab (`statusPiece`).
// Layer: marks. Pure: a box and a piece in, a path out.

/** A box whose top corners are cut off by `k`. */
export const chamfer = (l, t, r, b, k) => `M${l + k} ${t}H${r - k}L${r} ${t + k}V${b}H${l}V${t + k}Z`;

/** A box with its top right corner turned down: the outline has the corner cut, the flap is a triangle of its own. */
export const fold = (l, t, r, b, k) => `M${l} ${t}H${r - k}L${r} ${t + k}V${b}H${l}Z`;
export const flap = (r, t, k) => `M${r - k} ${t}L${r} ${t + k}H${r - k}Z`;

/** The folder tab over the left third of a place's top: the strip the status colour fills, from the top down to the tab's foot. */
export const tabStrip = (l, t, w, k) => `M${l} ${t}H${l + w / 3}L${l + w / 3 + k} ${t + k}H${l}Z`;

/**
 * A box whose top edge has a summit rising out of it: `rise` above the edge, `span` of the width across its foot, in the middle,
 * level where it leaves the edge and level at the top, at `tension`. The node's top is the summit's: the box starts `rise` lower.
 * Answers the whole outline, the summit's fill (between the top edge and the curve) and the two cubics.
 */
export function summit({ l, t, r, b, rise, span, tension }) {
  const top = t + rise, mid = (l + r) / 2, half = ((r - l) * span) / 2, xa = mid - half, xb = mid + half;
  const up = [[xa, top], [xa + tension * half, top], [mid - tension * half, t], [mid, t]], down = [[mid, t], [mid + tension * half, t], [xb - tension * half, top], [xb, top]];
  const curve = (c) => `C${c[1][0]} ${c[1][1]} ${c[2][0]} ${c[2][1]} ${c[3][0]} ${c[3][1]}`;
  return { outline: `M${l} ${top}H${xa}${curve(up)}${curve(down)}H${r}V${b}H${l}Z`, fill: `M${xa} ${top}${curve(up)}${curve(down)}Z`, cubics: [up, down] };
}

/** The outline a shape word draws, where it is one of this module's: `k` is the cut (a chamfer's, a fold's, a summit's rise). Else null. */
export function outlineOf(shape, l, t, r, b, k, { span, tension } = {}) {
  if (shape === 'chamfer') return chamfer(l, t, r, b, k);
  if (shape === 'fold') return fold(l, t, r, b, k);
  if (shape === 'summit') return summit({ l, t, r, b, rise: k, span: span ?? 0.4, tension: tension ?? 0.75 }).outline;
  return null;
}
