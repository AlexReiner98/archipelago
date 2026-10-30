// How well a picture is wired, counted from what is drawn. Each number is one fault, so a pass on the wires can be judged.
// Pure: a layout's answer in, numbers out.

/** A line with repeated points and points along a straight run taken out. */
function tidy(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Whether a wire runs against the way it has to go overall, for a stretch. */
export const doublesBack = (p) => {
  const dy = p.at(-1)[1] - p[0][1], dx = p.at(-1)[0] - p[0][0];
  return p.some((q, i) => i && ((q[1] - p[i - 1][1]) * Math.sign(dy) < -1 || (q[0] - p[i - 1][0]) * Math.sign(dx) < -1));
};

const sideOf = (r, p) => [[Math.abs(p[1] - r.t), 'top'], [Math.abs(p[1] - r.u), 'foot'], [Math.abs(p[0] - r.l), 'left'], [Math.abs(p[0] - r.r), 'right']].sort((u, v) => u[0] - v[0])[0][1];

/** Whether the end of a wire at `port` on box `r` faces away from the box `o` at its other end. */
export function wrongEnd(r, o, port) {
  const s = sideOf(r, port), over = o.l < r.r && o.r > r.l;
  if (s === 'top') return o.t >= r.t && (o.t >= r.u || over);
  if (s === 'foot') return o.u <= r.u && (o.u <= r.t || over);
  return s === 'left' ? o.l >= r.r : o.r <= r.l;
}

/**
 * The counts for `g`, a layout's answer: `bends`; `kinks`, bends past the fewest two boxes need; `jogs`, a short step between
 * runs going the same way; `wrongOrder` and `wrongTie`, wires with an end facing away from the other box; `back`, wires that
 * double back; `indirect`, two boxes that overlap on an axis with nothing between them whose wire is not one stretch; and
 * by the style's room, `tightPort`, a corner nearer a port than `run`, and `tightBox`, a wire nearer a box it passes
 * than `clear`, and `tightJoin`, joined boxes nearer than `join`.
 */
export function faults(g, { jog = 14, run = 0, clear = 0, join = 0, note = () => {} } = {}) {
  const rectOf = (id) => { const n = g.nodes.get(id), x = g.x.get(id), y = g.y.get(id); return { id, l: x - n.w / 2, r: x + n.w / 2, t: y - n.h / 2, u: y + n.h / 2 }; };
  const boxes = g.all.map((n) => rectOf(n.id)), wires = [...g.chains, ...g.ties].filter((w) => w.points && g.x.has(w.a) && g.x.has(w.b));
  const stands = (l, r, t, u, skip) => boxes.some((b) => !skip.includes(b.id) && r > b.l && l < b.r && u > b.t && t < b.u);
  const c = { wires: wires.length, bends: 0, kinks: 0, jogs: 0, wrongOrder: 0, wrongTie: 0, back: 0, indirect: 0, tightPort: 0, tightBox: 0, tightJoin: 0 };
  for (const w of wires) {
    const p = tidy(w.points), [ra, rb] = [rectOf(w.a), rectOf(w.b)], bends = p.length - 2;
    const overX = Math.min(ra.r, rb.r) - Math.max(ra.l, rb.l), overY = Math.min(ra.u, rb.u) - Math.max(ra.t, rb.t);
    c.bends += bends;
    c.kinks += Math.max(0, bends - (overX > 4 || overY > 4 ? 0 : 1));
    for (let i = 2; i < p.length - 1; i++) {
      const len = Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]), ax = p[i][0] === p[i - 1][0] ? 1 : 0;
      if (len < jog && Math.sign(p[i - 1][1 - ax] - p[i - 2][1 - ax]) === Math.sign(p[i + 1][1 - ax] - p[i][1 - ax])) c.jogs++;
    }
    if (wrongEnd(ra, rb, p[0]) || wrongEnd(rb, ra, p.at(-1))) c[w.type ? 'wrongTie' : 'wrongOrder']++;
    if (doublesBack(w.points)) c.back++;
    const mx = (Math.max(ra.l, rb.l) + Math.min(ra.r, rb.r)) / 2, my = (Math.max(ra.t, rb.t) + Math.min(ra.u, rb.u)) / 2;
    const openX = overX >= 2 && !stands(mx, mx, Math.min(ra.u, rb.u), Math.max(ra.t, rb.t), [w.a, w.b]), openY = overY >= 2 && !stands(Math.min(ra.r, rb.r), Math.max(ra.l, rb.l), my, my, [w.a, w.b]);
    if ((openX || openY) && bends) (c.indirect++, note('indirect', w, p));
    if (join) {
      const gap = Math.max(ra.t - rb.u, rb.t - ra.u, ra.l - rb.r, rb.l - ra.r);
      if (gap >= 0 && gap < join - 0.5) (c.tightJoin++, note('join', w, p));
    }
    if (bends > 0 && run) {
      const first = Math.abs(p[1][0] - p[0][0]) + Math.abs(p[1][1] - p[0][1]), lastRun = Math.abs(p.at(-1)[0] - p.at(-2)[0]) + Math.abs(p.at(-1)[1] - p.at(-2)[1]);
      c.tightPort += Number(first < run - 0.5) + Number(lastRun < run - 0.5);
      if (first < run - 0.5 || lastRun < run - 0.5) note('port', w, p);
    }
    if (clear) for (let i = 1; i < p.length; i++) {
      const [a, b] = [p[i - 1], p[i]];
      if (stands(Math.min(a[0], b[0]) - clear + 0.5, Math.max(a[0], b[0]) + clear - 0.5, Math.min(a[1], b[1]) - clear + 0.5, Math.max(a[1], b[1]) + clear - 0.5, [w.a, w.b])) { c.tightBox++; note('box', w, p); break; }
    }
  }
  return c;
}
