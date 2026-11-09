// Wires to one item that run on one another share a trunk (the kit, task e_7v52ek3c): a hub's links, a finding's reads.
// The longest is drawn whole; each after it is cut where it leaves what is drawn before it, so it starts at a stop on
// the trunk and no two wires share a stretch. A wire cut at its tail starts at its stop (`stop`); one cut at its head
// ends on the trunk, whose wire carries the one head (`toPort`). Layer: metrics. Pure: wires in, wires out.

const on = (p, a, b) => (a[0] === b[0] ? p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])
  : a[1] === b[1] ? p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) : false);
/** Whether the stretch p to q lies along one stretch of a drawn line. */
const along = (p, q, line) => line.some((a, i) => i > 0 && on(p, line[i - 1], a) && on(q, line[i - 1], a));

/**
 * `wires` of one bundle, each { points, hub: 'a' or 'b' } (which end is the item they share), its points from a to b.
 * Answers each wire with its points cut, longest first drawn; the order of `wires` is kept.
 */
export function bundle(wires) {
  const length = (w) => w.points.reduce((s, p, i) => s + (i ? Math.abs(p[0] - w.points[i - 1][0]) + Math.abs(p[1] - w.points[i - 1][1]) : 0), 0);
  const drawn = [], out = new Array(wires.length);
  for (const k of wires.map((w, k) => k).sort((p, q) => length(wires[q]) - length(wires[p]))) {
    const w = wires[k], line = w.hub === 'b' ? [...w.points].reverse() : w.points;
    let cut = 0;
    while (cut + 1 < line.length && drawn.some((d) => along(line[cut], line[cut + 1], d))) cut++;
    const kept = line.slice(cut).map((p) => [...p]);
    drawn.push(kept);
    if (!cut) out[k] = { ...w, points: w.points.map((p) => [...p]) };
    else out[k] = w.hub === 'b' ? { ...w, points: kept.reverse(), toPort: true } : { ...w, points: kept, stop: true };
  }
  return out;
}
