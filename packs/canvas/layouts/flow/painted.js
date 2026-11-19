// Islands whose look paints (decision e_rxj936fk, the owner, 17 Nov 2026: a live canvas per island; Field the first): the
// map asks for one surface over its picture (docs/layouts.md, surface) and each such island's look runs as a layout's
// code runs, `default({ canvas, answer, style, theme, size, view, on, open, hand, cursor })`, on a canvas of its own the
// size of the surface, with that island's items and links alone, and the map's camera on its island's frame (`view`).
// Each frame the part of each canvas inside its island's frame is laid into the surface, and the surface is shown: the
// raster carries the look's paint alone. A look runs to rest and then hands each item's place, once, and again only when
// its answer changes (`hand`, decision e_jfctpqza): the map then ends each wire from another island there and draws the
// session rings, ghosts, held badges and each item's click target as its own marks (./painted-wires.js), while the look
// draws everything else on its island, its own lines and hover included (decision e_a6kbgg8c, revised), and its paint
// goes on moving round still items. The map keeps the frame and the header. Nothing here reaches past the drawing's worker. The pointer over its
// island's land is handed to the look, in its screen pixels (a move as pointermove, a click as a press and a lift there,
// leaving as pointerleave), and so is the map's hover on an item it placed, as a move to where it stands; the cursor it
// asks for is the land's. A look's own frames are stopped when its picture ends: each look's animation frames carry the
// run that asked for them, and a run that ended is not called again. Layer: marks.

import { handedOf, wirePatches } from './painted-wires.js';
import { m as mark } from './marks.js';

export { shoreOnly } from './painted-wires.js';
import { hueClass, opacityOf, paintedTag, sessionsOn } from './session-ring.js';

/**
 * An item a look draws, as the map marks it: where it stands (`at:<id>`, moved when the look hands its place), the
 * rings of the sessions on it, each ring's tag over them (./session-ring.js), and the area that takes the pointer, each
 * sized round the radius the look hands.
 * Hidden (`unplaced`) until then.
 */
export function paintedBody({ item, x, y, gap, style, m }) {
  const on = sessionsOn(item), id = item.id;
  return m('g', { key: `at:${id}`, transform: `translate(${x} ${y})` },
    on.length && m('g', { class: 'lf-srs', 'aria-hidden': 'true' }, ...on.map((s, k) => ((faint) => m('g', { class: `lf-sr ${hueClass(s.hue)}${s.dormant ? ' dormant' : ''}`, ...(faint !== undefined && { opacity: faint }) },
      m('circle', { key: `ring:${id}:${k}`, class: 'lf-shape', r: gap * (k + 1) }),
      paintedTag({ s, item, k, rings: on.length, gap, style, m })))(opacityOf(s, style)))),
    m('circle', { key: `hit:${id}`, class: 'lf-hit', r: gap }));
}

/**
 * The patches that stand a placed item where its look drew it, its rings, their tags and pointer area round its radius.
 * A look that writes the rings' tags itself (it hands `tags: true`, overlap e_jhqsvwwh) has the map's tags hidden.
 */
export const itemPatches = (placed, items, gap, over = 0, ownTags = false) => [...placed].flatMap(([id, [x, y, r]]) => [
  { key: `s:${id}`, toggle: { unplaced: false } },
  { key: `at:${id}`, set: { transform: `translate(${x} ${y})` }, ...(over && { over }) },
  { key: `hit:${id}`, set: { r: Math.max(r, gap) } },
  ...sessionsOn(items.get(id)).flatMap((_, k, on) => [
    { key: `ring:${id}:${k}`, set: { r: r + gap * (k + 1) } },
    { key: `tag:${id}:${k}`, set: { transform: `translate(0 ${-(r + gap * on.length)})` }, toggle: { written: ownTags === true } },
  ]),
]);

/**
 * What the map does with what each look hands: `g` the composed model (its nodes, places, chains and ties), `painted`
 * the ids looks draw, `gap` the style's session gap, `draw` and `heads` the map's own path and heads of a wire, `order`
 * the type the chains are of, `over` how long a move takes. Answers (island, handed) => patches: the items it placed
 * stood there and shown, and every wire from another island ended on them. A place handed again moves there.
 */
export function placer({ g, painted, gap, draw, heads, order, over }) {
  const placed = new Map(), items = new Map([...g.nodes].map(([id, n]) => [id, n.item]));
  const boxes = new Map([...g.nodes].filter(([id]) => !painted.has(id)).map(([id, n]) => [id, { at: [g.x.get(id), g.y.get(id)], w: n.w, h: n.h }]));
  const wires = [...g.chains.map((w, n) => ({ key: `w:${n}`, head: `h:${n}`, w, type: order })), ...g.ties.map((w, n) => ({ key: `n:${n}`, head: `nh:${n}`, w, type: w.type }))];
  return (isle, handed) => {
    const again = [...handed.places.keys()].some((id) => placed.has(id)), changed = new Set(handed.places.keys());
    for (const [id, at] of handed.places) placed.set(id, at);
    const moving = again ? over : 0;
    return [...itemPatches(handed.places, items, gap, moving, handed.tags), ...wirePatches({ wires, boxes, placed, painted, changed, draw, heads, over: moving })];
  };
}

export const css = `
.lf-step.unplaced, .lf-wire.unplaced, .lf-tie.unplaced, .lf-head.unplaced { visibility: hidden; pointer-events: none; }
.lf-step .lf-sr circle.lf-shape { fill: none; }
.lf-step .lf-sr g.written { display: none; }
`;

/** How light a colour the page gives is: the sum of its channels, as rgb() writes them. */
const lightness = (v) => (([r = 0, g = 0, b = 0]) => Number(r) + Number(g) + Number(b))(String(v ?? '').match(/\d+(\.\d+)?/g) ?? []);

/** A colour as a canvas writes it back (#rrggbb or rgba()), where there is a canvas to ask; else as it was given. */
function asCanvasSays(v) {
  try {
    const c = new OffscreenCanvas(1, 1).getContext('2d');
    c.fillStyle = v;
    return c.fillStyle;
  } catch {
    return v;
  }
}

/** A colour's red, green and blue, as #rrggbb or rgb() write it, or as a canvas reads any other; null where it is none. */
function channels(v) {
  const given = String(v ?? '').trim(), t = /^(#|rgba?\()/i.test(given) ? given : asCanvasSays(given);
  const hex = /^#[0-9a-f]+$/i.test(t) ? t.slice(1).match(/[0-9a-f]{2}/gi) : null;
  const [r, g, b] = hex ? hex.map((h) => Number(`0x${h}`)) : /^rgba?\(/i.test(t) ? (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number) : [];
  return [r, g, b].every(Number.isFinite) ? [r, g, b] : null;
}

/**
 * The ground an island's land is tinted into: the sea, lifted toward the text by `lift` (0 to 1) where the theme is dark
 * (its text lighter than its sea), as the theme's `land_ground` colour is for the frame's own land (packs/canvas/pack.json;
 * `flow_island_ground` is the same share). This runs where no page is, so it is worked out here, not read off the page.
 */
export function groundOf(sea, text, lift) {
  const a = channels(sea), b = channels(text);
  if (!a || !b || !(lift > 0 && lift <= 1) || b[0] + b[1] + b[2] <= a[0] + a[1] + a[2]) return sea;
  return `rgb(${a.map((v, k) => Math.round(b[k] * lift + v * (1 - lift))).join(', ')})`;
}

/**
 * An island's land: its colour `hue` mixed into the sea at `tint` (0 to 1), as its frame's land is (./islands.js,
 * color-mix in srgb). Answers the sea where the island has no colour.
 */
export function landOf(hue, tint, sea) {
  const a = channels(hue), b = channels(sea);
  if (!a || !b || !(tint >= 0 && tint <= 1)) return sea;
  return `rgb(${a.map((v, k) => Math.round(v * tint + b[k] * (1 - tint))).join(', ')})`;
}

/**
 * The page's colours as a layout's code reads its theme: its island's land as its sea (`land`, else the page's), and
 * dark where its text is lighter than its land.
 */
function themeOf(colours, land) {
  const c = colours?.lens ?? {}, sea = land || c.land || c.sea;
  return { sea, text: c.text, muted: c.muted, line: c.line || c.muted, accent: c.accent, dark: lightness(c.text) > lightness(sea) };
}

/** The animation frames of the worker, each carrying the run that asked for it: a run that ended asks no more. */
function framesByRun() {
  const KEY = Symbol.for('pelago.island-frames');
  if (globalThis[KEY]) return globalThis[KEY];
  const raw = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame.bind(globalThis) : (f) => setTimeout(() => f(performance.now()));
  let running = null;
  globalThis.requestAnimationFrame = (f) => {
    const run = running;
    return raw((t) => {
      if (run?.ended) return;
      const was = running;
      running = run;
      try { f(t); } finally { running = was; }
    });
  };
  return (globalThis[KEY] = { as: (run, fn) => { const was = running; running = run; try { return fn(); } finally { running = was; } } });
}

/**
 * Start painting `islands` ({ id, at: [x, y], size: [w, h], look, answer, hue?, tint? }: where each stands in the
 * picture, its look's module with its `settings`, what it holds, and its colour and its land's tint, the ground its frame
 * is painted in) into the surface. There is one camera, the map's: each look paints at
 * the screen's own pixels, on a canvas the surface's size, and is handed `view()`, its island's frame ({ width, height },
 * in the picture's units) and where that frame lands on screen ({ k, tx, ty }: a unit of it is k pixels, its corner at
 * tx, ty), heard as 'view' each time the map pans or zooms. A look fits its picture to the frame, not to its canvas, and
 * so follows the map as one with it: no canvas is remade as one zooms, and words are written at their own size. Each
 * frame the part of each canvas inside its island's frame is laid into the surface. What a look hands (`hand`, in its
 * frame's units) is checked and given to `placed(id, handed)`, whose patches are sent to the page. Answers { view, end,
 * pointer, item }: the first view comes once the page has mounted the scene, which is what makes the surface; asked
 * sooner, the page has none to give, and says so for good.
 */
export function paintIslands({ islands, tools, placed }) {
  let over = false, view = null, begun;
  const runs = [];
  const frames = framesByRun();
  const mounted = new Promise((resolve) => (begun = resolve));
  /** What a look says by the pointer, beside the item the pointer is on: its first line bold, the rest under it. */
  const tipOn = (r, text) => {
    const [head, ...rest] = String(text ?? '').split('\n');
    tools.patch?.([{ tip: text == null || !r.hot ? null : { key: `s:${r.hot}`, mark: mark('div', { class: 'lf-tip' }, mark('b', {}, head), ...rest.map((t) => mark('span', {}, t))) } }]);
  };
  (async () => {
    await mounted;
    const surface = over ? null : await tools.surface?.();
    if (!surface || over) return;
    const ctx = surface.canvas.getContext('2d');
    const size = { width: 1, height: 1, dpr: 1 };
    for (const isle of islands) runs.push({ id: isle.id, ended: false, canvas: new OffscreenCanvas(1, 1), w: isle.size[0], h: isle.size[1], at: isle.at, cam: { width: isle.size[0], height: isle.size[1], k: 1, tx: 0, ty: 0 }, heard: new Map(), hot: null, own: new Set((isle.answer.items ?? []).map((i) => i.id)), places: new Map() });
    /** Where each island's frame lands on screen now, in the surface's own pixels (not the device's); 'view' told where it moved. */
    const place = () => {
      const k = size.width / Math.max(1, view.width);
      for (const r of runs) {
        const tx = (r.at[0] - view.x) * k, ty = (r.at[1] - view.y) * k;
        if (r.cam.k === k && r.cam.tx === tx && r.cam.ty === ty) continue;
        Object.assign(r.cam, { k, tx, ty });
        if (!r.ended) frames.as(r, () => r.heard.get('view')?.());
      }
    };
    const fit = () => {
      Object.assign(size, { width: surface.size.width, height: surface.size.height, dpr: surface.size.dpr || 1 });
      surface.canvas.width = Math.max(1, Math.round(size.width * size.dpr));
      surface.canvas.height = Math.max(1, Math.round(size.height * size.dpr));
      place();
      for (const r of runs) if (!r.ended) frames.as(r, () => r.heard.get('resize')?.());
    };
    fit();
    runs.forEach((r, k) => {
      const isle = islands[k];
      // One ground: the look's frame painted in its island's land, under its paint, and that land its theme's sea. An
      // island with no colour of its own is tinted with the line's, as its frame's land is (./islands.js, .lf-island).
      const lens = surface.colours?.lens ?? {};
      r.land = landOf(isle.hue || lens.line || lens.muted, isle.tint, groundOf(lens.sea, lens.text, isle.ground));
      const theme = themeOf(surface.colours, r.land);
      try {
        frames.as(r, () => isle.look.default({
          canvas: r.canvas, answer: isle.answer, style: isle.look.settings ?? {}, theme, size, hot: null, view: () => r.cam,
          on: (name, fn) => r.heard.set(name, fn), open: (id) => (tools.patch?.([{ tip: null }]), tools.open?.(id)), tip: (text) => tipOn(r, text), cursor: (name) => tools.patch?.([{ key: `paint:${r.id}`, toggle: { pointing: name === 'pointer' } }]),
          // Its items' places, once it has settled: the map's tip, hover and lines are drawn there.
          hand: (said) => {
            const handed = !r.ended && handedOf(said, r.own, r.at);
            if (handed) (r.places = handed.places), tools.patch?.(placed(r.id, handed));
          },
        }));
      } catch {
        r.ended = true;
      }
    });
    surface.resized?.((now) => ((surface.size = now), fit()));
    // Each frame of the page: the part of every island's canvas inside its frame, laid where it stands, and the surface shown.
    while (!over) {
      await tools.frame();
      if (over) break;
      place();
      ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
      for (const r of runs) {
        // Its ground is laid whatever its look does (one that ended, or has not yet sized its canvas): the frame is cut
        // out of the island's land, so without it the sea would show there, a shade off the land round the header.
        const d = size.dpr, x0 = Math.max(0, Math.floor(r.cam.tx * d)), y0 = Math.max(0, Math.floor(r.cam.ty * d));
        const x1 = Math.min(surface.canvas.width, Math.ceil((r.cam.tx + r.w * r.cam.k) * d)), y1 = Math.min(surface.canvas.height, Math.ceil((r.cam.ty + r.h * r.cam.k) * d));
        if (x1 > x0 && y1 > y0 && r.land) (ctx.fillStyle = r.land), ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        const [cx, cy] = [Math.min(x1, r.canvas.width), Math.min(y1, r.canvas.height)];
        if (!r.ended && r.canvas.width > 1 && cx > x0 && cy > y0) ctx.drawImage(r.canvas, x0, y0, cx - x0, cy - y0, x0, y0, cx - x0, cy - y0);
      }
      surface.show();
    }
  })();
  /** The pointer over island `id`'s land: `name` move, leave or click, `at` where, in the picture's units. Answers no patch: the look's cursor comes as it says it. */
  const pointer = (id, name, at) => {
    const r = runs.find((x) => x.id === id);
    if (!r || r.ended || !view) return [];
    const k = r.cam.k, x = at ? r.cam.tx + (at[0] - r.at[0]) * k : 0, y = at ? r.cam.ty + (at[1] - r.at[1]) * k : 0;
    const say = (n, e) => frames.as(r, () => r.heard.get(n)?.({ x, y, button: 0, buttons: 0, id: 0, kind: 'mouse', ...e }));
    if (name === 'leave') say('pointerleave');
    else if (name === 'move' && at) say('pointermove');
    else if (name === 'click' && at) (say('pointermove'), say('pointerdown', { buttons: 1 }), say('pointerup'));
    return [];
  };
  /** The map's hover on an item a look placed, told to that look as the pointer coming to where it stands, or leaving. */
  const item = (id, on) => {
    const r = runs.find((x) => x.places.has(id));
    if (r) r.hot = on ? id : null;
    return r ? pointer(r.id, on ? 'move' : 'leave', r.places.get(id)) : [];
  };
  return { view: (v) => ((view = v), begun()), end: () => ((over = true), begun(), runs.forEach((r) => (r.ended = true))), pointer, item, painted: (id) => runs.some((r) => r.own.has(id)) };
}
