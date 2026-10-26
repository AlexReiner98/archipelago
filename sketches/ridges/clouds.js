// Clouds as one system: moist air on the wind, and mountains in its way (26 Oct 2026). What mountains do to moist air,
// roughly as the WMO cloud atlas tells it: air driven up a windward slope cools and makes cloud there; a cap sits on
// a summit that reaches the condensation level; downwind the cloud trails off as a banner, and where the air is set
// swinging, lens-shaped wave clouds stand over the crests, evenly spaced downstream, with clear air in the troughs.
// Here the sky's noise is that moist air, drawn out along the wind. Where it is moist enough it makes cloud by
// itself; a mountain lifts it, so cloud forms on summits sooner where the air is moister; and the air sinking in a
// mountain's lee dries, clearing the sky's own cloud there. Both kinds drift on the same wind and float at one height.
// The rows are the page's depth: a wind across the page drifts cloud along a row, a wind into or out of the page
// carries it to the rows in front or behind.

/**
 * The cloud shapes of each row, to draw just after that row's land. rows: [{ y, yc, h }] with h the row's land
 * height at each x of xs. Off (all empty) when the Clouds dial is 0.
 */
export function clouds({ d, rows, xs, dx, gap, sky, puff, seam, shore, smooth }) {
  const out = rows.map(() => []);
  if (d.clouds <= 0) return out;
  const R = rows.length, N = xs.length, period = N - 1;
  let hmax = 1;
  for (const { h } of rows) for (const v of h) if (v > hmax) hmax = v;
  const Hn = rows.map(({ h }) => h.map((v) => v / hmax));

  // The wind blows toward windDir: 0 to the right, 90 out of the page (to the nearer rows), 180 left, 270 into it.
  const a = (d.windDir * Math.PI) / 180, wx = Math.cos(a), wy = Math.sin(a), s = d.wind;
  // How mountainous the sky's cloud is: 0 all the air's own, 1 all lifted by the land.
  const p = Math.max(0, Math.min(1, d.cloudPeaks));
  // The condensation level, as a share of the tallest land: more cover, lower the level, more summits reach it.
  const level = 1 - d.clouds * 0.85, edge = 1 - d.clouds * 0.6, k = 0.9 / Math.max(0.1, d.cloudSize);
  // An x index on the row, round the seam when the picture repeats; null off the row.
  const ix = (f) => (d.wrap ? ((f % period) + period) % period : f < 0 || f > N - 1 ? null : f);
  const hAt = (r, i) => (r < 0 || r >= R ? 0 : Hn[r][ix(i)]);

  // The moist air: slow noise over the plan of the page (x across, the rows as depth), drawn out along the wind so
  // its clouds lie in streets the way it blows. With repeat on, seam() joins it at the edges like everything else.
  const stretch = 1 + 1.5 * Math.min(1, s);
  const moist = rows.map(({ yc }) => xs.map((x) => seam((cx, z) => sky((cx * wx + z * wy) / stretch, z * wx - cx * wy), x, k * 1.8, 3, yc * k * 1.8 + 11)));

  // Where cloud forms. The land: caps on summits past the level (lower where the air is moister), and with wind the
  // windward slopes below them. The air: wherever it is moist enough by itself.
  const land = Hn.map((row, r) => row.map((hn, i) => {
    const lv = level - 0.5 * (moist[r][i] - 0.5), cap = smooth(lv, lv + 0.2, hn);
    if (s <= 0 || hn <= 0) return cap;
    const gx = (hAt(r, i + 1) - hAt(r, i - 1)) / (2 * dx), gy = (hAt(r + 1, i) - hAt(r - 1, i)) / (2 * gap);
    const up = (wx * gx + wy * gy) * gap * 3;
    return Math.max(cap, 0.8 * Math.min(1, s) * smooth(0, 0.4, up) * smooth(lv * 0.5, lv, hn));
  }));
  // Air over land is lifted a little too (warmed, nudged up by the slopes), so the sky's clouds gather round the islands.
  const air = moist.map((row, r) => row.map((m, i) => { const e = edge - 0.12 * Math.min(1, Hn[r][i] * 3); return smooth(e, e + 0.09, m); }));
  const L = soften(land), A = soften(air);
  const at = (F, rf, f) => {
    const i = ix(f);
    if (i === null || rf < 0 || rf > R - 1) return 0;
    const r0 = Math.floor(rf), i0 = Math.floor(i), tr = rf - r0, ti = i - i0, r1 = Math.min(R - 1, r0 + 1), i1 = Math.min(N - 1, i0 + 1);
    return (F[r0][i0] * (1 - ti) + F[r0][i1] * ti) * (1 - tr) + (F[r1][i0] * (1 - ti) + F[r1][i1] * ti) * tr;
  };

  // Carried downwind: each point looks upwind. The land's cloud close by is the banner, still joined to its peak;
  // farther on, only the crests of the lee waves, fading with distance, and in the troughs between, sinking dry air.
  // The air's own cloud just drifts and fades.
  const reach = gap * 8 * s * d.cloudSize, wave = gap * 3 * d.cloudSize, T = 18;
  const made = rows.map((_, r) => xs.map((_, i) => {
    let lv = L[r][i], av = A[r][i], dry = 0;
    for (let t = 1; s > 0 && t <= T; t++) {
      const dist = (t / T) * reach, rf = r - (wy * dist) / gap, f = i - (wx * dist) / dx, fade = Math.exp(-dist / (reach * 0.6));
      const src = at(L, rf, f);
      if (src) {
        const cos = Math.cos((2 * Math.PI * dist) / wave);
        const banner = smooth(wave * 0.7, 0, dist), crest = dist > wave * 0.5 ? smooth(0.55, 1, cos) * smooth(0.2, 1, s) : 0;
        lv = Math.max(lv, src * fade * Math.max(banner, 0.9 * crest));
        if (dist > wave * 0.25) dry = Math.max(dry, src * fade * smooth(0.2, 1, -cos));
      }
      av = Math.max(av, at(A, rf, f) * Math.exp(-dist / (reach * 0.35)));
    }
    return Math.max((0.5 + 0.5 * p) * lv, (1 - p) * av * (1 - 0.85 * dry));
  })).map((row) => blur(row, Math.max(1, Math.round((gap * 0.8) / dx)), d.wrap));

  rows.forEach(({ y, yc }, r) => {
    // Broken a little by the moist air, so one cloud thins and thickens as the air does.
    const amount = xs.map((x, i) => made[r][i] * (0.7 + 0.6 * moist[r][i]) * shore(x, y, yc));
    // Every cloud has its base at the condensation level: caps hide the summits that reach it, wave clouds stand at
    // the height of the peaks that raised them, and the air's own clouds float at the same height among them.
    const base = y - gap * 0.55 - Math.min(level * hmax * (0.3 + 0.7 * p), Math.max(0, y - d.margin - gap * 2)), cstep = gap * 0.9;
    for (let i = 0; i < N; ) {
      if (amount[i] < 0.05) { i++; continue; }
      let j = i;
      while (j < N && amount[j] >= 0.05) j++;
      if (j - i >= 3) {
        const top = [];
        for (let q = i; q < j; q++) {
          // A dome (the square root of cover) with broad, slow billows, so tops round like cumulus, not peaks.
          const raw = Math.sqrt(amount[q]) * gap * d.cloudPuff * (0.9 + 0.9 * seam(puff, xs[q], k * 1.6, 7, yc * k)), n = Math.floor(raw / cstep);
          top.push([xs[q], base - cstep * (n + smooth(0.05, 1, raw / cstep - n)) - gap * 0.15]);
        }
        if (d.cloudShadow > 0) out[r].push({ shadow: d.cloudShadow, points: [[xs[i], y - gap * 0.12], [xs[j - 1], y - gap * 0.12], [xs[j - 1], y + gap * 0.12], [xs[i], y + gap * 0.12]] });
        out[r].push({ cloud: true, points: [[xs[i], base], ...top, [xs[j - 1], base]] });
      }
      i = j;
    }
  });
  return out;

  /** A field softened along each row and across its neighbours, so cloud follows forms, not each terrace step. */
  function soften(F) {
    const along = F.map((row) => blur(row, Math.max(1, Math.round((gap * 1.2) / dx)), d.wrap));
    return along.map((row, r) => row.map((v, i) => 0.25 * (along[Math.max(0, r - 1)][i] + along[Math.min(R - 1, r + 1)][i]) + 0.5 * v));
  }
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
