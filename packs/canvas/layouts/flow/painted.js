// Islands whose look paints (decision e_rxj936fk, the owner, 17 Nov 2026: a live canvas per island; Field the first): the
// map asks for one surface over its picture (docs/layouts.md, surface) and each such island's look runs as a layout's
// code runs, `default({ canvas, answer, style, theme, size, view, on, open, tip, cursor })`, on a canvas of its own the
// size of the surface, with that island's items and links alone, and the map's camera on its island's frame (`view`).
// Each frame the part of each canvas inside its island's frame is laid into the surface, and the surface is shown. The map keeps the frame, the header and the wires to other islands.
// Nothing here reaches past the drawing's worker. The pointer over its island's land is handed to the look, in its
// screen pixels (a move as pointermove, a click as a press and a lift there, leaving as pointerleave); what it says by
// the pointer (tip) is shown beside a spot the map moves to that place, and the cursor it asks for is the land's. A look
// that says where it draws each item (places) has the wires from outside carried on to them, from its frame's edge. A look's own frames are stopped when its picture ends: each look's animation frames carry the run that
// asked for them, and a run that ended is not called again. Layer: marks.

/** How light a colour the page gives is: the sum of its channels, as rgb() writes them. */
import { m } from './marks.js';

export { comingIn } from './painted-wires.js';

const lightness = (v) => (([r = 0, g = 0, b = 0]) => Number(r) + Number(g) + Number(b))(String(v ?? '').match(/\d+(\.\d+)?/g) ?? []);

/** The page's colours as a layout's code reads its theme: the island's land as its sea, and dark where its text is lighter than its land. */
function themeOf(colours) {
  const c = colours?.lens ?? {};
  return { sea: c.land || c.sea, text: c.text, muted: c.muted, line: c.line || c.muted, accent: c.accent, dark: lightness(c.text) > lightness(c.land || c.sea) };
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
 * Start painting `islands` ({ id, at: [x, y], size: [w, h], look, answer }: where each stands in the picture, its look's
 * module with its `settings`, and what it holds) into the surface. There is one camera, the map's: each look paints at
 * the screen's own pixels, on a canvas the surface's size, and is handed `view()`, its island's frame ({ width, height },
 * in the picture's units) and where that frame lands on screen ({ k, tx, ty }: a unit of it is k pixels, its corner at
 * tx, ty), heard as 'view' each time the map pans or zooms. A look fits its picture to the frame, not to its canvas, and
 * so follows the map as one with it: no canvas is remade as one zooms, and words are written at their own size. Each
 * frame the part of each canvas inside its island's frame is laid into the surface. Answers { view, end }: the first
 * view comes once the page has mounted the scene, which is what makes the surface; asked sooner, the page has none to
 * give, and says so for good.
 */
export function paintIslands({ islands, tools, wire }) {
  let over = false, view = null, begun;
  const runs = [];
  const frames = framesByRun();
  const mounted = new Promise((resolve) => (begun = resolve));
  /** What the look says by the pointer, beside a spot moved to where it says it, in the picture's units. */
  const tipAt = (r, text, x, y) => {
    if (text == null) return void tools.patch?.([{ tip: null }]);
    const px = r.at[0] + (x - r.cam.tx) / r.cam.k, py = r.at[1] + (y - r.cam.ty) / r.cam.k, [head, ...rest] = String(text).split('\n');
    tools.patch?.([{ key: `spot:${r.id}`, set: { x: px, y: py } }, { tip: { key: `spot:${r.id}`, mark: m('div', { class: 'lf-tip' }, m('b', {}, head), ...rest.map((t) => m('span', {}, t))) } }]);
  };
  /** A wire's stretch from where it meets the island's frame to where the look draws its item, with its head there if it has one. */
  const carryWires = (ctx, r, d, theme) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.cam.tx * d, r.cam.ty * d, r.w * r.cam.k * d, r.h * r.cam.k * d);
    ctx.clip();
    ctx.strokeStyle = ctx.fillStyle = theme.muted || theme.line;
    ctx.lineWidth = wire.stroke * d;
    for (const w of r.wires) {
      const to = r.where(w.item);
      if (!to) continue;
      const fx = (r.cam.tx + (w.at[0] - r.at[0]) * r.cam.k) * d, fy = (r.cam.ty + (w.at[1] - r.at[1]) * r.cam.k) * d;
      const len = Math.hypot(to[0] * d - fx, to[1] * d - fy);
      if (len < 1) continue;
      const ux = (to[0] * d - fx) / len, uy = (to[1] * d - fy) / len, end = Math.max(0, len - (to[2] ?? 0) * d), ex = fx + ux * end, ey = fy + uy * end;
      const [hl, hh] = wire.head.map((v) => v * d);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(w.head ? ex - ux * hl : ex, w.head ? ey - uy * hl : ey);
      ctx.stroke();
      if (!w.head) continue;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * hl - uy * hh, ey - uy * hl + ux * hh);
      ctx.lineTo(ex - ux * hl + uy * hh, ey - uy * hl - ux * hh);
      ctx.fill();
    }
    ctx.restore();
  };
  (async () => {
    await mounted;
    const surface = over ? null : await tools.surface?.();
    if (!surface || over) return;
    const ctx = surface.canvas.getContext('2d');
    const size = { width: 1, height: 1, dpr: 1 };
    for (const isle of islands) runs.push({ id: isle.id, ended: false, canvas: new OffscreenCanvas(1, 1), w: isle.size[0], h: isle.size[1], at: isle.at, cam: { width: isle.size[0], height: isle.size[1], k: 1, tx: 0, ty: 0 }, heard: new Map(), wires: isle.wires ?? [], where: null });
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
    const theme = themeOf(surface.colours);
    runs.forEach((r, k) => {
      const isle = islands[k];
      try {
        frames.as(r, () => isle.look.default({
          canvas: r.canvas, answer: isle.answer, style: isle.look.settings ?? {}, theme, size, hot: null, view: () => r.cam,
          on: (name, fn) => r.heard.set(name, fn), open: (id) => tools.open?.(id), tip: (text, x, y) => tipAt(r, text, x, y), cursor: (name) => tools.patch?.([{ key: `paint:${r.id}`, toggle: { pointing: name === 'pointer' } }]),
          places: (fn) => (r.where = typeof fn === 'function' ? fn : null),
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
        if (r.ended || r.canvas.width <= 1) continue;
        const d = size.dpr, x0 = Math.max(0, Math.floor(r.cam.tx * d)), y0 = Math.max(0, Math.floor(r.cam.ty * d));
        const x1 = Math.min(r.canvas.width, surface.canvas.width, Math.ceil((r.cam.tx + r.w * r.cam.k) * d)), y1 = Math.min(r.canvas.height, surface.canvas.height, Math.ceil((r.cam.ty + r.h * r.cam.k) * d));
        if (x1 > x0 && y1 > y0) ctx.drawImage(r.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        if (r.wires.length && r.where) carryWires(ctx, r, size.dpr, theme);
      }
      surface.show();
    }
  })();
  /** The pointer over island `id`'s land: `name` move, leave or click, `at` where, in the picture's units. Answers no patch: the look's own tip and cursor come as it says them. */
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
  return { view: (v) => ((view = v), begun()), end: () => ((over = true), begun(), runs.forEach((r) => (r.ended = true))), pointer };
}
