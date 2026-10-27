// Clouds as one system, grown from the mountains (26 Oct 2026). What mountains do to moist air, roughly as the WMO
// cloud atlas tells it: air driven up a windward slope cools and makes cloud there; a cap sits on a summit that
// reaches the condensation level; downwind the cloud trails off as a banner, and where the air is set swinging,
// lens-shaped wave clouds stand over the crests, evenly spaced downstream, with clear air in the troughs.
// That mountain cloud is the seed, the way a letter seeds the land: a reaction-diffusion field grows out of it over
// the plan of the page, pulled and drawn out by the wind, so the rest of the sky's cloud is the peaks' cloud spread
// on (spots at light cover, streets and labyrinths toward overcast). All of it floats at one height.
// The rows are the page's depth: a wind across the page drifts cloud along a row, a wind into or out of the page
// carries it to the rows in front or behind.

import { grow, sample } from './diffusion.js';

/**
 * The cloud shapes of each row, to draw just after that row's land. rows: [{ y, yc, h }] with h the row's land
 * height at each x of xs. Off (all empty) when the Clouds dial is 0.
 */
export function clouds({ d, rows, xs, dx, gap, puff, seam, shore, smooth }) {
  const out = rows.map(() => []);
  if (d.clouds <= 0) return out;
  const R = rows.length, N = xs.length, period = N - 1;
  let hmax = 1;
  for (const { h } of rows) for (const v of h) if (v > hmax) hmax = v;
  const Hn = rows.map(({ h }) => h.map((v) => v / hmax));

  // The wind blows toward windDir: 0 to the right, 90 out of the page (to the nearer rows), 180 left, 270 into it.
  const a = (d.windDir * Math.PI) / 180, wx = Math.cos(a), wy = Math.sin(a), s = d.wind;
  // The condensation level, as a share of the tallest land: more cover, lower the level, more summits reach it.
  const level = 1 - d.clouds * 0.85, k = 0.9 / Math.max(0.1, d.cloudSize);
  // An x index on the row, round the seam when the picture repeats; null off the row.
  const ix = (f) => (d.wrap ? ((f % period) + period) % period : f < 0 || f > N - 1 ? null : f);
  const hAt = (r, i) => (r < 0 || r >= R ? 0 : Hn[r][ix(i)]);

  // Where the land makes cloud: caps on summits past the level, and with wind the windward slopes below them.
  const land = Hn.map((row, r) => row.map((hn, i) => {
    const cap = smooth(level, level + 0.2, hn);
    if (s <= 0 || hn <= 0) return cap;
    const gx = (hAt(r, i + 1) - hAt(r, i - 1)) / (2 * dx), gy = (hAt(r + 1, i) - hAt(r - 1, i)) / (2 * gap);
    const up = (wx * gx + wy * gy) * gap * 3;
    return Math.max(cap, 0.8 * Math.min(1, s) * smooth(0, 0.4, up) * smooth(level * 0.5, level, hn));
  }));
  const L = soften(land);
  const at = (F, rf, f) => {
    const i = ix(f);
    if (i === null || rf < 0 || rf > R - 1) return 0;
    const r0 = Math.floor(rf), i0 = Math.floor(i), tr = rf - r0, ti = i - i0, r1 = Math.min(R - 1, r0 + 1), i1 = Math.min(N - 1, i0 + 1);
    return (F[r0][i0] * (1 - ti) + F[r0][i1] * ti) * (1 - tr) + (F[r1][i0] * (1 - ti) + F[r1][i1] * ti) * tr;
  };

  // Carried downwind: each point looks upwind. The land's cloud close by is the banner, still joined to its peak;
  // farther on, only the crests of the lee waves, fading with distance, and in the troughs between, sinking dry air.
  const reach = gap * 8 * s * d.cloudSize, wave = gap * 3 * d.cloudSize, T = 18;
  const dry = rows.map(() => new Float32Array(N));
  const peaks = rows.map((_, r) => xs.map((_, i) => {
    let lv = L[r][i];
    for (let t = 1; s > 0 && t <= T; t++) {
      const dist = (t / T) * reach, src = at(L, r - (wy * dist) / gap, i - (wx * dist) / dx);
      if (!src) continue;
      const fade = Math.exp(-dist / (reach * 0.6)), cos = Math.cos((2 * Math.PI * dist) / wave);
      const banner = smooth(wave * 0.7, 0, dist), crest = dist > wave * 0.5 ? smooth(0.55, 1, cos) * smooth(0.2, 1, s) : 0;
      lv = Math.max(lv, src * fade * Math.max(banner, 0.9 * crest));
      if (dist > wave * 0.25) dry[r][i] = Math.max(dry[r][i], src * fade * smooth(0.2, 1, -cos));
    }
    return lv;
  }));

  // The spread: a reaction-diffusion field over the plan of the page (x across, the rows as depth), its cloud shown
  // near the peaks' cloud and thinning away from it, so it seems to grow out of them across the sky, the way a letter
  // seeds the land. Away from a seed the field's threshold rises: its cloud joins the peaks' close by, and farther
  // out breaks into smaller and fewer pieces until the Spread dial's reach, where the sky is clear.
  const spread = Math.max(0, d.cloudSpread), span = period * dx, depth = (R - 1) * gap;
  const reach2 = spread * 0.7 * Math.max(span, depth);
  const far = spread > 0 ? fromSeeds() : null, field = spread > 0 ? readFor() : null;
  const lo = 0.6 - 0.45 * d.clouds;
  const fromSpread = (r, i) => {
    if (!far) return 0;
    const q = i / far.every, t = q - Math.floor(q), row = far.dist[r], nq = far.nq;
    const q0 = d.wrap ? Math.floor(q) % nq : Math.min(nq - 1, Math.floor(q)), q1 = d.wrap ? (q0 + 1) % nq : Math.min(nq - 1, q0 + 1);
    // Past the reach (or where no seed is, at an endless distance) the sky is clear.
    if (row[q0] >= reach2 || row[q1] >= reach2) return 0;
    const dist = row[q0] * (1 - t) + row[q1] * t;
    const thr = lo + (1.02 - lo) * smooth(0, reach2, dist) ** 0.6;
    return smooth(thr, thr + 0.12, sample(field.f, i * dx * field.sx, r * gap * field.sz)) * (1 - 0.85 * dry[r][i]);
  };
  // From peaks: how much the mountains' own cloud leads, against the spread grown from it. Toward 1 the caps,
  // banners and wave clouds stand full and the spread thins; the cloud base rises to the condensation level too.
  const p = Math.max(0, Math.min(1, d.cloudPeaks));
  const made = peaks.map((row, r) => row.map((v, i) => Math.max((0.5 + 0.5 * p) * v, (1 - 0.5 * p) * fromSpread(r, i)))).map((row) => blur(row, Math.max(1, Math.round((gap * 0.8) / dx)), d.wrap));

  rows.forEach(({ y, yc }, r) => {
    // Every cloud has its base at the condensation level: caps hide the summits that reach it, wave clouds stand at
    // the height of the peaks that raised them, and the spread's clouds float at the same height among them.
    const base = y - gap * 0.55 - Math.min(level * hmax * (0.3 + 0.7 * p), Math.max(0, y - d.margin - gap * 2)), cstep = gap * 0.9;
    // The border reckoned from the cloud's tops (as high as its heart could billow there), as the land's is, and
    // ending about where the land's does rather than fading out across the whole band.
    const amount = xs.map((x, i) => made[r][i] * smooth(0.2, 0.65, shore(x, y, yc, y - base + gap * (0.15 + 1.8 * d.cloudPuff * Math.sqrt(made[r][i])))));
    const runs = [];
    for (let i = 0; i < N; ) {
      if (!(amount[i] >= 0.05)) { i++; continue; }
      let j = i;
      while (j < N && amount[j] >= 0.05) j++;
      runs.push({ i, j, from: i, length: j - 1 - i, most: Math.max(...amount.slice(i, j)) });
      i = j;
    }
    // With repeat on, a cloud across the seam is one cloud in two pieces: one length and one heart for both, so
    // it rounds off at its two real ends and not where the picture joins.
    const first = runs[0], last = runs[runs.length - 1];
    if (d.wrap && runs.length > 1 && first.i === 0 && last.j === N) {
      const length = first.j - 1 + (N - 1 - last.i), most = Math.max(first.most, last.most);
      Object.assign(last, { length, most });
      Object.assign(first, { from: last.i - (N - 1), length, most });
    }
    for (const { i, j, from, length, most } of runs) {
      // A sliver is dropped, unless it runs on across the seam into its other half.
      if (j - i < 3 && !(d.wrap && (i === 0 || j === N))) continue;
      const top = [];
      for (let q = i; q < j; q++) {
        // A dome along a curve: from the tips' billow at the cloud's thin ends to the heart's where it is thickest,
        // eased so the tips stay small and the heart stays full. It is bounded by a dome over the cloud's length
        // too, so one evenly thick throughout still rounds off at its ends instead of standing as a bar (a cloud
        // all the way round a repeating row has no ends). A thinner cloud's heart stands lower. Broad, slow billows
        // over it, so tops round like cumulus, not peaks.
        const along = i === 0 && j === N && d.wrap ? 1 : 1 - Math.abs((2 * (q - from)) / Math.max(1, length) - 1) ** 2.5;
        const c = smooth(0, 1, Math.min(amount[q] / most, along)), lift = d.cloudTip + (d.cloudPuff - d.cloudTip) * c;
        const raw = Math.sqrt(most) * lift * gap * (0.9 + 0.9 * seam(puff, xs[q], k * 1.6, 7, yc * k)), n = Math.floor(raw / cstep);
        top.push([xs[q], base - cstep * (n + smooth(0.05, 1, raw / cstep - n)) - gap * 0.15]);
      }
      if (d.cloudShadow > 0) out[r].push({ shadow: d.cloudShadow, points: [[xs[i], y - gap * 0.12], [xs[j - 1], y - gap * 0.12], [xs[j - 1], y + gap * 0.12], [xs[i], y + gap * 0.12]] });
      out[r].push({ cloud: true, points: [[xs[i], base], ...top, [xs[j - 1], base]] });
    }
  });
  return out;

  /** A field softened along each row and across its neighbours, so cloud follows forms, not each terrace step. */
  function soften(F) {
    const along = F.map((row) => blur(row, Math.max(1, Math.round((gap * 1.2) / dx)), d.wrap));
    return along.map((row, r) => row.map((v, i) => 0.25 * (along[Math.max(0, r - 1)][i] + along[Math.min(R - 1, r + 1)][i]) + 0.5 * v));
  }

  /**
   * The cloud field and the scale to read it at: drawn out along the wind, across the page more than in depth (where
   * a long cloud would stand as a tower), and whole tiles across when it repeats.
   */
  function readFor() {
    const f = fieldFor(d.seed), tile = 300 * Math.max(0.1, d.cloudSize), st = 1.5 * Math.min(1, s);
    let sx = f.nx / tile / (1 + st * wx * wx);
    if (d.wrap) sx = (Math.max(1, Math.round((span * sx) / f.nx)) * f.nx) / span;
    return { f, sx, sz: f.ny / tile / (1 + 0.35 * st * wy * wy) };
  }

  /**
   * How far each place is from the peaks' cloud, on a coarse grid (every few x of a row, every row), in page units,
   * cheaper downwind: a step with the wind costs less than one against it, so the spread reaches farther in the
   * lee of the peaks than upwind of them. Raster sweeps there and back, a few times, round the seam when it repeats.
   */
  function fromSeeds() {
    const every = 4, nq = d.wrap ? Math.round(period / every) : Math.floor(period / every) + 1, size = nq * R;
    const dist = new Float32Array(size).fill(Infinity), bias = 0.65 * Math.min(1, s);
    for (let r = 0; r < R; r++) for (let q = 0; q < nq; q++) if (peaks[r][Math.min(N - 1, q * every)] > 0.15) dist[r * nq + q] = 0;
    // A step from a neighbour at (oq, or) to here moves by (-oq, -or): its cost by how far it runs with the wind.
    const cost = ([oq, or]) => { const px = -oq * every * dx, pz = -or * gap, len = Math.hypot(px, pz); return len * (1 - (bias * (px * wx + pz * wy)) / len); };
    const back = [[-1, 0], [-1, -1], [0, -1], [1, -1]], fwd = back.map(([oq, or]) => [-oq, -or]);
    const sweep = (offs, rs, qs) => {
      const c = offs.map(cost);
      for (const r of rs) for (const q of qs) {
        let best = dist[r * nq + q];
        offs.forEach(([oq, or], n) => {
          const r2 = r + or;
          let q2 = q + oq;
          if (r2 < 0 || r2 >= R) return;
          if (d.wrap) q2 = (q2 + nq) % nq;
          else if (q2 < 0 || q2 >= nq) return;
          const v = dist[r2 * nq + q2] + c[n];
          if (v < best) best = v;
        });
        dist[r * nq + q] = best;
      }
    };
    const up = Array.from({ length: R }, (_, r) => r), across = Array.from({ length: nq }, (_, q) => q);
    for (let n = 0; n < 3; n++) (sweep(back, up, across), sweep(fwd, [...up].reverse(), [...across].reverse()));
    return { every, nq, dist: up.map((r) => dist.subarray(r * nq, (r + 1) * nq)) };
  }
}

/** The cloud's reaction-diffusion field (diffusion.js: spots and worms side by side), grown once a seed and kept. */
let cloudField = {};
function fieldFor(seed) {
  if (cloudField.seed !== seed) cloudField = { seed, f: grow({ nx: 64, ny: 64, pattern: 0.35, variety: 0.5, steps: 2500, seed: seed * 13 + 5 }) };
  return cloudField.f;
}

/** A row averaged over a window of rad each side, round the seam when it repeats (its ends one place). */
function blur(row, rad, wrap) {
  const n = row.length, period = n - 1, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let o = -rad; o <= rad; o++) {
      let j = i + o;
      if (wrap) j = ((j % period) + period) % period;
      else if (j < 0 || j >= n) continue;
      (sum += row[j]), count++;
    }
    out[i] = sum / count;
  }
  if (wrap) out[n - 1] = out[0];
  return out;
}
