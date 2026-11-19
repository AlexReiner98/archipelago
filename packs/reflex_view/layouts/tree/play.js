// Layer: marks. The tree played over real dates (./film.js), a frame at a time, as patches to the marks ./draw.js
// made. Each node comes in on its day, its branch drawn out of its parent. A miss sparks amber where it happened,
// swelling and fading (reflex_spark, reflex_spark_grow over reflex_spark_life seconds): on the trial node written
// from it, else on the bough of its place, which then keeps a quiet ring, a gap (rt-gap). A saying that held runs a
// blue light from the root along the branches to its node (reflex_pulse seconds), a trail behind it, and flashes
// there (to reflex_flash over reflex_flash_time); one whose miss came back runs the same in the failure colour. The
// camera starts close on the root and pulls back as the tree spreads (at most reflex_zoom_most, easing by
// reflex_zoom_ease). The counts over the picture are the week to the film's day: misses against held. Nothing here
// runs under reduced motion: the tree stands whole.

import { at } from './marks.js';
import { HIDDEN } from './draw.js';
import { weekTo } from './story.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A player for the tree: `step(dt)` answers the patches for dt seconds more; `replay()` starts it from the root. */
export function player({ tree, placed, film, story, z, n, pools, from, fresh, speed }) {
  const { place, polar, along, centre, reach } = placed;
  const life = n('reflex_spark_life'), pulse = n('reflex_pulse'), flashFor = n('reflex_flash_time');
  const ring = z('reflex_ring');
  const sparks = Array(pools.sparks).fill(null), lights = Array(pools.lights).fill(null);
  let t, shown, zoom, next, counts, nextSpark, gaps;
  const reset = (start) => {
    t = start;
    shown = new Set();
    zoom = 0;
    // The next event to play: those before the start are past.
    next = film.events.findIndex((e) => e.t > start);
    if (next < 0) next = film.events.length;
    counts = { misses: -1, held: -1, day: '' };
    nextSpark = 0;
    gaps = new Set();
  };
  reset(from);
  // A node new since this view was last drawn is born now, once the film is past.
  const reborn = new Map();
  const xy = (id) => place.get(id);
  // A node lit (born, or reached by a light) shows its name though it gives way, for reflex_name_linger seconds.
  const litUntil = new Map();
  const lit = (node, out) => {
    if (!litUntil.has(node.id)) out.push({ key: `n:${node.id}`, toggle: { 'rt-lit': true } });
    litUntil.set(node.id, t + n('reflex_name_linger'));
  };
  const sparkAt = (node, start, out) => {
    const i = nextSpark++ % sparks.length;
    sparks[i] = { node, start };
    out.push({ key: `sp:${i}`, set: { opacity: 1 } });
    lit(node, out);
  };
  // The points a light runs along, root first.
  const route = (node) => {
    const chain = [];
    for (let u = node; u.parent; u = u.parent) chain.push(u);
    return chain.reverse().flatMap((u, i) => (i ? along.get(u.id).slice(1) : along.get(u.id)));
  };
  const step = (dt) => {
    const out = [];
    t += dt * speed.now;
    // Born: a node comes in and its branch grows out of its parent; one written sparks.
    for (const node of tree.born) {
      if (shown.has(node.id)) continue;
      const at0 = reborn.has(node.id) ? reborn.get(node.id) : film.born.get(node.id);
      if (at0 > t) continue;
      shown.add(node.id);
      out.push({ key: `n:${node.id}`, toggle: { on: true } }, { key: `b:${node.id}`, set: { 'stroke-dashoffset': 0 } });
    }
    // The camera: close on what is grown, out to the whole.
    const extent = Math.max(0, ...[...shown].map((id) => polar.get(id).r));
    const target = clamp(reach / (extent + ring / 2), 1, n('reflex_zoom_most'));
    zoom = zoom === 0 || dt === 0 ? target : zoom + (target - zoom) * (1 - Math.exp(-dt * n('reflex_zoom_ease')));
    out.push({ key: 'cam', set: { transform: `translate(${at(centre.x)} ${at(centre.y)}) scale(${Math.round(zoom * 1000) / 1000}) translate(${at(-centre.x)} ${at(-centre.y)})` } });
    const scale = clamp(zoom, n('reflex_spark_zoom_least'), n('reflex_spark_zoom_most')) / zoom;
    sparks.forEach((s, i) => {
      if (!s) return;
      const age = t - s.start;
      if (age >= life || age < 0) return void ((sparks[i] = null), out.push({ key: `sp:${i}`, set: { opacity: 0 } }));
      const p = xy(s.node.id), r = (z('reflex_spark') + z('reflex_spark_grow') * Math.sqrt(age)) * scale;
      out.push({ key: `sp:${i}`, set: { transform: `translate(${at(p.x)} ${at(p.y)}) scale(${at(r)})`, opacity: (1 - age / life).toFixed(2) } });
    });
    // What happened by now: a miss sparks, a saying runs a light; a miss that grew nothing leaves a gap.
    for (; next < film.events.length && film.events[next].t <= t; next++) {
      const e = film.events[next];
      if (e.kind === 'miss') {
        sparkAt(e.node, e.t, out);
        if (!e.grew && !gaps.has(e.node.id)) gaps.add(e.node.id), out.push({ key: `n:${e.node.id}`, toggle: { 'rt-gap': true } });
        continue;
      }
      const free = lights.indexOf(null);
      if (free < 0 || !e.node.parent) continue;
      lights[free] = { node: e.node, start: e.t, route: route(e.node), failed: e.kind === 'failed' };
      out.push({ key: `lg:${free}`, toggle: { 'rt-failed': e.kind === 'failed' } }, { key: `lt:${free}`, toggle: { 'rt-failed': e.kind === 'failed' } }, { key: `lh:${free}`, toggle: { 'rt-failed': e.kind === 'failed' } });
    }
    lights.forEach((l, i) => {
      if (!l) return;
      const u = Math.min(1, (t - l.start) / pulse), last = l.route.length - 1;
      const flash = u < 1 ? 1 : 1 - (t - l.start - pulse) / flashFor;
      if (u >= 1 && !l.reached) (l.reached = true), lit(l.node, out);
      if (flash <= 0) return void ((lights[i] = null), out.push({ key: `lt:${i}`, set: { opacity: 0 } }, { key: `lg:${i}`, set: { opacity: 0 } }, { key: `lh:${i}`, set: { opacity: 0 } }));
      const head = u * last, k = Math.min(last - 1, Math.floor(head)), f = head - k;
      const a = l.route[k], b = l.route[k + 1], hx = a[0] + (b[0] - a[0]) * f, hy = a[1] + (b[1] - a[1]) * f;
      const d = `M${l.route.slice(0, k + 1).map((p) => `${at(p[0])} ${at(p[1])}`).join(' L')} L${at(hx)} ${at(hy)}`;
      const r = (u < 1 ? z('reflex_light') : z('reflex_light') + (z('reflex_flash') - z('reflex_light')) * (1 - flash)) / zoom;
      out.push(
        { key: `lt:${i}`, set: { d, opacity: flash.toFixed(2) } },
        { key: `lg:${i}`, set: { transform: `translate(${at(hx)} ${at(hy)}) scale(${at(r)})`, opacity: flash.toFixed(2) } },
        { key: `lh:${i}`, set: { cx: at(hx), cy: at(hy), opacity: u < 1 ? 1 : 0 } },
      );
    });
    for (const [id, until] of litUntil) if (t > until) litUntil.delete(id), out.push({ key: `n:${id}`, toggle: { 'rt-lit': false } });
    // The counts: the week to the film's day, misses against held.
    const date = film.dateAt(t), week = weekTo(story, date), day = new Date(date).toISOString().split('T')[0];
    if (week.misses !== counts.misses) out.push({ key: 'rt-miss-n', text: week.misses.toLocaleString('en-US') });
    if (week.held !== counts.held) out.push({ key: 'rt-held-n', text: week.held.toLocaleString('en-US') });
    if (day !== counts.day) out.push({ key: 'rt-day', text: day });
    counts = { ...week, day };
    return out;
  };
  const hide = () => {
    const out = [];
    for (const node of tree.born) out.push({ key: `n:${node.id}`, toggle: { on: false } }, { key: `b:${node.id}`, set: { 'stroke-dashoffset': HIDDEN } });
    sparks.fill(null);
    lights.fill(null);
    for (const id of litUntil.keys()) out.push({ key: `n:${id}`, toggle: { 'rt-lit': false } });
    litUntil.clear();
    for (const id of gaps) out.push({ key: `n:${id}`, toggle: { 'rt-gap': false } });
    for (let i = 0; i < pools.sparks; i++) out.push({ key: `sp:${i}`, set: { opacity: 0 } });
    for (let i = 0; i < pools.lights; i++) out.push({ key: `lt:${i}`, set: { opacity: 0 } }, { key: `lg:${i}`, set: { opacity: 0 } }, { key: `lh:${i}`, set: { opacity: 0 } });
    return out;
  };
  // What is new since last drawn is born a moment after the picture opens.
  for (const node of fresh) reborn.set(node.id, from + n('reflex_film_lead'));
  for (const node of tree.born) if (!reborn.has(node.id) && film.born.get(node.id) <= from) shown.add(node.id);
  return { step, replay: () => { const out = hide(); reborn.clear(); reset(0); return out; } };
}
