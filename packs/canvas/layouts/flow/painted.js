// Islands whose look paints (decision e_rxj936fk, the owner, 17 Nov 2026: a live canvas per island; Field the first): the
// map asks for one surface over its picture (docs/layouts.md, surface) and each such island's look runs as a layout's
// code runs, `default({ canvas, answer, style, theme, size, on, open, tip, cursor })`, on a canvas of its own the size of
// the island's frame, with that island's items and links alone. Each frame the canvases are laid into the surface where
// their islands stand, and the surface is shown. The map keeps the frame, the header and the wires to other islands.
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
 * module with its `settings`, and what it holds) into the surface; `most` the most pixels across an island is painted
 * at. The surface lies over the pane while the picture pans and zooms under it, so each frame every island is laid
 * where the latest view (`view`: what is in sight, in the picture's units) puts it, and an island whose size on screen
 * has halved or doubled is painted again at that size. Answers { view, end }: the first view comes once the page has
 * mounted the scene, which is what makes the surface; asked sooner, the page has none to give, and says so for good.
 */
export function paintIslands({ islands, tools, most }) {
  let over = false, view = null, begun;
  const runs = [];
  const frames = framesByRun();
  const mounted = new Promise((resolve) => (begun = resolve));
  (async () => {
    await mounted;
    const surface = over ? null : await tools.surface?.();
    if (!surface || over) return;
    const ctx = surface.canvas.getContext('2d');
    for (const isle of islands) runs.push({ ended: false, canvas: new OffscreenCanvas(1, 1), w: isle.size[0], h: isle.size[1], at: isle.at, size: { width: 1, height: 1, dpr: 1 }, heard: new Map() });
    /** How many of the surface's pixels a unit of the picture is, as it is in sight now. */
    const unit = () => surface.canvas.width / Math.max(1, view.width);
    const sized = (r) => {
      const k = Math.min(1, most / Math.max(r.w, r.h) / unit()) * unit(), was = r.size.width / Math.max(1, r.w);
      if (was && k / was < 2 && was / k < 2) return;
      (r.size.width = r.w * k), (r.size.height = r.h * k), r.heard.get('resize')?.();
    };
    const fit = () => {
      surface.canvas.width = Math.max(1, Math.round(surface.size.width * (surface.size.dpr || 1)));
      surface.canvas.height = Math.max(1, Math.round(surface.size.height * (surface.size.dpr || 1)));
      runs.forEach(sized);
    };
    fit();
    const theme = themeOf(surface.colours);
    runs.forEach((r, k) => {
      const isle = islands[k];
      try {
        frames.as(r, () => isle.look.default({
          canvas: r.canvas, answer: isle.answer, style: isle.look.settings ?? {}, theme, size: r.size, hot: null,
          on: (name, fn) => r.heard.set(name, fn), open: (id) => tools.open?.(id), tip: () => {}, cursor: () => {},
        }));
      } catch {
        r.ended = true;
      }
    });
    surface.resized?.((now) => ((surface.size = now), fit()));
    // Each frame of the page: every island's canvas laid where the view puts it, and the surface shown.
    while (!over) {
      await tools.frame();
      if (over) break;
      const u = unit();
      ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
      for (const r of runs) {
        if (r.ended || r.canvas.width <= 1) continue;
        sized(r);
        ctx.drawImage(r.canvas, (r.at[0] - view.x) * u, (r.at[1] - view.y) * u, r.w * u, r.h * u);
      }
      surface.show();
    }
  })();
  return { view: (v) => ((view = v), begun()), end: () => ((over = true), begun(), runs.forEach((r) => (r.ended = true))) };
}
