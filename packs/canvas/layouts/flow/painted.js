// Islands whose look paints (decision e_rxj936fk, the owner, 17 Nov 2026: a live canvas per island; Field the first): the
// map asks for one surface over its picture (docs/layouts.md, surface) and each such island's look runs as a layout's
// code runs, `default({ canvas, answer, style, theme, size, view, on, open, tip, cursor })`, on a canvas of its own the
// size of the surface, with that island's items and links alone, and the map's camera on its island's frame (`view`).
// Each frame the part of each canvas inside its island's frame is laid into the surface, and the surface is shown. The map keeps the frame, the header and the wires to other islands.
// Nothing here reaches past the drawing's worker. The pointer is not yet passed in: a look paints, and an item opens
// from its page. A look's own frames are stopped when its picture ends: each look's animation frames carry the run that
// asked for them, and a run that ended is not called again. Layer: marks.

/** How light a colour the page gives is: the sum of its channels, as rgb() writes them. */
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
export function paintIslands({ islands, tools }) {
  let over = false, view = null, begun;
  const runs = [];
  const frames = framesByRun();
  const mounted = new Promise((resolve) => (begun = resolve));
  (async () => {
    await mounted;
    const surface = over ? null : await tools.surface?.();
    if (!surface || over) return;
    const ctx = surface.canvas.getContext('2d');
    const size = { width: 1, height: 1, dpr: 1 };
    for (const isle of islands) runs.push({ ended: false, canvas: new OffscreenCanvas(1, 1), w: isle.size[0], h: isle.size[1], at: isle.at, cam: { width: isle.size[0], height: isle.size[1], k: 1, tx: 0, ty: 0 }, heard: new Map() });
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
          on: (name, fn) => r.heard.set(name, fn), open: (id) => tools.open?.(id), tip: () => {}, cursor: () => {},
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
      }
      surface.show();
    }
  })();
  return { view: (v) => ((view = v), begun()), end: () => ((over = true), begun(), runs.forEach((r) => (r.ended = true))) };
}
