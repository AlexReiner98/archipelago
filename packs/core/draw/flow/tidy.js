// A small part of a picture, set in even rows. Each box stands at its step down the links, each row is centred on what it
// joins, neighbours keep one gap, and the gaps between rows are alike. A wire leaves the middle of a box's foot and comes
// into the middle of a box's head, straight down where they line up, else across on a bus it shares with the others of
// its fan. The order along each row comes from the picture it is given. Pure: boxes and links in, places and lines out.

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;

/** Each box's step: as low as what comes before it says, and what starts nothing is drawn down to what it feeds. */
function stepsDown(list, links) {
  const step = new Map(list.map((id) => [id, 0])), into = new Map(list.map((id) => [id, []])), outOf = new Map(list.map((id) => [id, []]));
  for (const [a, b] of links) (into.get(b).push(a), outOf.get(a).push(b));
  for (let round = 0; round < list.length; round++) for (const [a, b] of links) if (step.get(b) <= step.get(a)) step.set(b, step.get(a) + 1);
  for (let round = 0; round < list.length; round++) for (const id of list) if (!into.get(id).length && outOf.get(id).length) step.set(id, Math.min(...outOf.get(id).map((k) => step.get(k))) - 1);
  return { step };
}

/** The nearest places to `wants`, in order and each `apart(i)` from the one before (pool adjacent violators). */
function inOrder(wants, apart) {
  let run = 0;
  const pools = [];
  wants.forEach((want, i) => {
    run += i ? apart(i) : 0;
    let pool = { sum: want - run, n: 1 };
    while (pools.length && pools.at(-1).sum / pools.at(-1).n >= pool.sum / pool.n) { const p = pools.pop(); pool = { sum: p.sum + pool.sum, n: p.n + pool.n }; }
    pools.push(pool);
  });
  const out = [];
  let at = 0;
  for (const pool of pools) for (let k = 0; k < pool.n; k++) (at += out.length ? apart(out.length) : 0, out.push(pool.sum / pool.n + at));
  return out;
}

/**
 * `links` are [upper, lower, how firmly], with no way when not firm; `from` where each box stands now, by its middle; `size(id)`
 * its box and `block(id)` that with what hangs beside it. Answers as a drawn part does: `places`, and `points` by link.
 */
export function tidy(list, links, from, size, block, z) {
  const firm = links.filter((l) => l[2]), { step } = stepsDown(list, firm), into = new Map(list.map((id) => [id, []])), outOf = new Map(list.map((id) => [id, []]));
  // A wire past a row has a place in that row of its own, so it takes a column and goes round no one.
  const passing = new Set(), places0 = new Map(from), wires = links.map(([a, b]) => {
    const [upper, lower] = step.get(a) <= step.get(b) ? [a, b] : [b, a], path = [upper];
    for (let k = step.get(upper) + 1; k < step.get(lower); k++) {
      const id = `~${upper}~${lower}~${k}`;
      passing.add(id);
      step.set(id, k);
      places0.set(id, (from.get(upper) + from.get(lower)) / 2);
      into.set(id, []);
      outOf.set(id, []);
      path.push(id);
    }
    path.push(lower);
    if (step.get(upper) !== step.get(lower)) for (let i = 1; i < path.length; i++) (outOf.get(path[i - 1]).push(path[i]), into.get(path[i]).push(path[i - 1]));
    return { a, b, path };
  });
  const everyone = [...step.keys()], steps = [...new Set(step.values())].sort((p, q) => p - q);
  const rows = steps.map((k) => everyone.filter((id) => step.get(id) === k).sort((p, q) => places0.get(p) - places0.get(q) || (p < q ? -1 : 1)));
  // What it joins, by the mean place: the rows take the order that crosses least, from the top and then from the foot.
  for (let sweep = 0; sweep < 4; sweep++) {
    const walk = sweep % 2 ? [...rows.keys()].reverse() : [...rows.keys()], joined = sweep % 2 ? outOf : into, place = new Map(rows.flatMap((r) => r.map((id, k) => [id, k - (r.length - 1) / 2])));
    for (const k of walk) {
      const at = new Map(rows[k].map((id, n) => [id, joined.get(id).length ? mean(joined.get(id).map((o) => place.get(o))) : n - (rows[k].length - 1) / 2]));
      rows[k].sort((p, q) => at.get(p) - at.get(q) || (p < q ? -1 : 1));
      rows[k].forEach((id, n) => place.set(id, n - (rows[k].length - 1) / 2));
    }
  }
  const left = (id) => (passing.has(id) ? 0 : size(id).w / 2), right = (id) => (passing.has(id) ? 0 : block(id).w - size(id).w / 2), x = new Map();
  const apartIn = (row) => (i) => right(row[i - 1]) + z.row_gap + left(row[i]);
  for (const row of rows) {
    let at = -row.reduce((sum, id, i) => sum + (i ? apartIn(row)(i) : 0), 0) / 2;
    row.forEach((id, i) => { at += i ? apartIn(row)(i) : 0; x.set(id, at); });
  }
  // A run of one to one stands on one line, whatever passes through; a wire past a row with it.
  const runOf = new Map();
  for (const id of everyone) {
    if (runOf.has(id) || into.get(id).length > 1 || outOf.get(id).length > 1) continue;
    const run = [id];
    for (let at = id; outOf.get(at).length === 1 && into.get(outOf.get(at)[0]).length === 1 && outOf.get(outOf.get(at)[0]).length <= 1; at = outOf.get(at)[0]) run.push(outOf.get(at)[0]);
    for (let at = id; into.get(at).length === 1 && outOf.get(into.get(at)[0]).length === 1 && into.get(into.get(at)[0]).length <= 1; at = into.get(at)[0]) run.unshift(into.get(at)[0]);
    if (run.length > 1) for (const v of run) runOf.set(v, run);
  }
  // Each box over what it joins, the rows keeping their order and their gap; last from the foot up, so what feeds stands centred.
  for (let sweep = 0; sweep < 12; sweep++) {
    const up = sweep % 2 === 1, walk = up ? [...rows.keys()].reverse() : [...rows.keys()];
    for (const k of walk) {
      const row = rows[k], want = row.map((id) => {
        if (runOf.has(id)) return mean(runOf.get(id).map((o) => x.get(o)));
        const near = up ? outOf.get(id) : into.get(id), all = near.length ? near : up ? into.get(id) : outOf.get(id);
        return all.length ? mean(all.map((o) => x.get(o))) : x.get(id);
      });
      inOrder(want, apartIn(row)).forEach((v, i) => x.set(row[i], v));
    }
  }
  const real = (r) => r.filter((id) => !passing.has(id)), leads = rows.map((r) => Math.max(0, ...real(r).map((id) => block(id).lead)));
  const tall = rows.map((r, k) => leads[k] + Math.max(0, ...real(r).map((id) => block(id).h - block(id).lead)));
  const rowOf = (id) => steps.indexOf(step.get(id));
  // One bus for each box many wires come into, or go out of: each fan on a track of its own in its gap.
  const fan = (p, q) => (into.get(q).length > 1 ? `to ${q}` : `from ${p}`), spans = new Map();
  for (const { path } of wires) for (let i = 1; i < path.length; i++) {
    const [p, q] = [path[i - 1], path[i]];
    if (step.get(p) === step.get(q) || Math.abs(x.get(p) - x.get(q)) < 1) continue;
    const gapAt = rowOf(p), k = `${gapAt} ${fan(p, q)}`, s = spans.get(k) ?? { gapAt, lo: Infinity, hi: -Infinity };
    spans.set(k, { ...s, lo: Math.min(s.lo, x.get(p), x.get(q)), hi: Math.max(s.hi, x.get(p), x.get(q)) });
  }
  const tracks = new Map(), most = new Map();
  for (const [k, s] of [...spans].sort((p, q) => (p[1].hi - p[1].lo) - (q[1].hi - q[1].lo) || (p[0] < q[0] ? -1 : 1))) {
    const taken = [...spans].filter(([o]) => tracks.has(o) && spans.get(o).gapAt === s.gapAt && spans.get(o).lo < s.hi + z.turn && s.lo < spans.get(o).hi + z.turn).map(([o]) => tracks.get(o));
    let t = 0;
    while (taken.includes(t)) t++;
    tracks.set(k, t);
    most.set(s.gapAt, Math.max(most.get(s.gapAt) ?? 0, t));
  }
  const gap = z.row_space + Math.max(0, ...most.values()) * z.turn, top = [];
  rows.forEach((_, k) => (top[k] = k ? top[k - 1] + tall[k - 1] + gap : 0));
  const places = new Map(), headOf = (id) => top[rowOf(id)] + leads[rowOf(id)], footOf = (id) => headOf(id) + (passing.has(id) ? 0 : size(id).h);
  for (const r of rows) for (const id of real(r)) places.set(id, [x.get(id) - left(id) + block(id).w / 2, headOf(id) - block(id).lead]);
  const points = new Map();
  for (const { a, b, path } of wires) {
    const line = [];
    if (path.length === 2 && step.get(a) === step.get(b)) {
      const [p, q] = x.get(a) <= x.get(b) ? [a, b] : [b, a], at = headOf(p) + size(p).h / 2;
      line.push([x.get(p) + right(p), at], [x.get(q) - left(q), at]);
      if (p !== path[0]) line.reverse();
    } else {
      line.push([x.get(path[0]), footOf(path[0])]);
      for (let i = 1; i < path.length; i++) {
        const [p, q] = [path[i - 1], path[i]], [xp, xq] = [x.get(p), x.get(q)], end = headOf(q);
        if (Math.abs(xp - xq) >= 1) {
          const bus = end - z.row_space / 2 - (tracks.get(`${rowOf(p)} ${fan(p, q)}`) ?? 0) * z.turn;
          line.push([xp, bus], [xq, bus]);
        }
        line.push([xq, end]);
        if (i < path.length - 1) line.push([xq, footOf(q)]);
      }
    }
    const same = line.filter((p, i) => !i || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1]);
    const tidied = same.filter((p, i) => !i || i === same.length - 1 || !((same[i - 1][0] === p[0] && p[0] === same[i + 1][0]) || (same[i - 1][1] === p[1] && p[1] === same[i + 1][1])));
    points.set(pair(a, b), path[0] === a ? { from: a, to: b, points: tidied } : { from: a, to: b, points: [...tidied].reverse() });
  }
  return { places, points, crossings: 0, up: 0, set: true };
}
