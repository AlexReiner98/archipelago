// Layer: metrics. The streets between rows: each wire's run across a street is an interval, the runs packed onto
// tracks by the left-edge method (./tracks.js), merged runs on one; a street is as tall as its tracks, and the rows
// stand between the streets. Pure: rows' heights and the wires' stops across in; each row's y and each run's track y out.

import { packed } from './tracks.js';

/** The sets that merge: each key to its representative, keys joined when one run carries both. */
function joined() {
  const up = new Map();
  const find = (k) => {
    while (up.has(k) && up.get(k) !== k) k = up.get(k);
    return k;
  };
  return { find, join: (p, q) => { const [a, b] = [find(p), find(q)]; if (a !== b) up.set(b, a); } };
}

/**
 * Where everything stands down: `heights` is each row's height (rows 0..n-1), `wires` each { id, stops (x of each
 * stop), street (of its first run), merge { a, b } }: run k crosses street `street + k`, from stops[k] to stops[k+1].
 * Answers { rowY, streetY, streetH, track: wire id -> list of each run's track y (or null where it goes straight) }.
 */
export function streetsOf(heights, wires, z) {
  const n = heights.length, runs = Array.from({ length: n + 1 }, () => []), sets = joined();
  for (const w of wires) {
    const last = w.stops.length - 2;
    for (let k = 0; k <= last; k++) {
      const keys = [`${w.id}#${k}`, ...(k === 0 && w.merge.a ? [w.merge.a] : []), ...(k === last && w.merge.b ? [w.merge.b] : []), ...(w.merge.ways ? [`${w.merge.ways}#${w.street + k}`] : [])];
      for (const key of keys.slice(1)) sets.join(keys[0], key);
      const [lo, hi] = [w.stops[k], w.stops[k + 1]];
      // Each end of the run turns up (toward the street's first track) or down: from above, or on into a row below.
      const first = k === 0 ? w.a.side !== 'top' : true, next = k === last ? !(w.b.side === 'top' || w.b.side === 'port') : false;
      runs[w.street + k].push({ wire: w.id, k, key: keys[0], lo, hi, merged: keys.length > 1, ends: [{ at: lo, near: first }, { at: hi, near: next }] });
    }
  }
  const streetH = [], at = new Map();
  runs.forEach((list, s) => {
    const wanted = list.filter((r) => r.merged || Math.abs(r.hi - r.lo) > z.straight);
    const { track, count } = packed(wanted.map((r) => ({ key: sets.find(r.key), lo: r.lo, hi: r.hi, ends: r.ends })), z.lane / 2);
    for (const r of wanted) at.set(`${r.wire}#${r.k}`, { s, t: track.get(sets.find(r.key)) });
    const outer = s === 0 || s === n;
    streetH.push(count ? 2 * z.pad + (count - 1) * z.track : outer ? 0 : z.street_least);
  });
  const rowY = [], streetY = [];
  let y = 0;
  for (let s = 0; s <= n; s++) {
    streetY.push(y);
    y += streetH[s];
    if (s < n) (rowY.push(y), (y += heights[s]));
  }
  const track = new Map(wires.map((w) => [w.id, w.stops.slice(1).map((_, k) => {
    const got = at.get(`${w.id}#${k}`);
    return got ? streetY[got.s] + z.pad + got.t * z.track : null;
  })]));
  return { rowY, streetY, streetH, track, bottom: y };
}
