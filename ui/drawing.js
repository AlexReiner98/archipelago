// A picture drawn by a drawing: code a pack ships or the map keeps (a style's `drawing`), run in the sandbox
// (draw.html, draw.js), answering with marks the page checks and mounts (marks.js). The page keeps what every
// picture has around its marks: the stage that pans and zooms, the key, the bar with the lit switch and zoom, a
// published page's still frame. One frame serves every picture on the page and is started before it is needed;
// each drawing's code is sent once and kept by its hash. A drawing whose scene asks for a surface has the frames it
// paints in its worker shown on a canvas laid over its picture (surface.js).

import { h } from './base.js';
import { tipOf } from './drawing-tip.js';
import { build, cssFor, patch, step } from './marks.js';
import { STYLE_COLORS, litSwitch, numberOf, sizeOf } from './lens-base.js';
import { surfaceOf } from './surface.js';
import { typeTitle } from './words.js';
import { panZoom } from './pan-zoom.js';

/**
 * Each drawing's modules, by its hash: a lens answer leaves out those the page already has (`have`). The last few
 * are kept in this browser, so a page opened again has them at once: loaded while its first answer is on its way,
 * and not sent again. Kept by hash, a drawing kept is the drawing sent.
 */
export const drawings = new Map();
const KEPT = 'pelago-drawings';
try {
  for (const [hash, modules] of JSON.parse(localStorage.getItem(KEPT) ?? '[]')) drawings.set(hash, modules);
} catch {
  // Without storage, each page is sent its drawings.
}
function keepDrawing(hash, modules) {
  drawings.delete(hash);
  drawings.set(hash, modules);
  try {
    localStorage.setItem(KEPT, JSON.stringify([...drawings].slice(-3)));
  } catch {
    // Kept for this page only.
  }
}
const sheets = new Map();
/** The scenes drawn lately, by the drawing and all it was given: drawn again from the same, a picture is mounted at once. */
const scenes = new Map();
let sandbox;

/** The frame every drawing runs in, started once: before a picture asks, wherever one may be drawn. */
export function warmDrawings() {
  // A frame taken off the page (a page that draws its body anew) is started again: its workers went with it.
  if (sandbox?.frame.isConnected) return sandbox;
  // Not hidden: a frame that is not drawn has its worker slowed many times over. It is drawn with no size instead (flow.css).
  const frame = h('iframe', { class: 'drawing-sandbox', sandbox: 'allow-scripts', src: '/draw.html', title: 'Where drawings run', tabindex: '-1', 'aria-hidden': 'true' });
  const loads = new Map();
  sandbox = { frame, loads, ready: null };
  sandbox.ready = new Promise((resolve) => {
    addEventListener('message', (ev) => {
      if (ev.source !== frame.contentWindow) return;
      const said = ev.data ?? {};
      if (said.type === 'ready') resolve();
      const load = loads.get(said.hash);
      if (!load) return;
      if (said.type === 'loaded') load.resolve();
      // A drawing that failed to start, or was stopped, starts again for the next picture that asks.
      if (said.type === 'failed' || said.type === 'stopped') (loads.delete(said.hash), load.reject(new Error(String(said.message ?? 'The drawing stopped.').slice(0, 300))), load.stopped?.());
    });
  });
  // Beside the body, not in it, so a page that draws its body anew does not take it away.
  document.documentElement.append(frame);
  // What this browser drew last is loaded now, before an answer asks for it.
  for (const [hash, modules] of drawings) loaded(hash, modules).catch(() => {});
  return sandbox;
}

/** The drawing with this hash, loaded in the frame. */
async function loaded(hash, modules) {
  const box = warmDrawings();
  await box.ready;
  if (!box.loads.has(hash)) {
    const load = {};
    load.promise = new Promise((resolve, reject) => Object.assign(load, { resolve, reject }));
    box.loads.set(hash, load);
    box.frame.contentWindow.postMessage({ type: 'load', hash, modules }, '*');
  }
  return box.loads.get(hash).promise;
}

/** A drawing's stylesheet, on the page once however many pictures it draws. */
function adopt(id, css) {
  if (!css || sheets.has(id)) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssFor(id, css));
  sheets.set(id, sheet);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

/** The colours a picture is drawn in, as the page has them now: the page's own (by the theme's names) and the lens's. */
function colours(host, style) {
  const css = getComputedStyle(host), read = (name) => css.getPropertyValue(name).trim();
  return {
    page: Object.fromEntries(Object.keys(style.theme?.light ?? {}).map((name) => [name, read(`--${name.replaceAll('_', '-')}`)])),
    lens: Object.fromEntries(STYLE_COLORS.map((name) => [name, read(`--ln-${name}`)])),
  };
}

/** Draw the answer in host with the drawing its style names. The same call as any of the kernel's shapes. */
export function drawWith(host, answer, style, keep) {
  host.endDrawing?.();
  const { drawing } = style;
  const failed = (message) => host.replaceChildren(h('div', { class: 'lens-error' }, `This drawing stopped: ${String(message).slice(0, 300)}`));
  // Its code: sent with the answer, kept by this browser, or fetched from this server by its hash (a published page's).
  const sent = drawing?.modules ?? drawings.get(drawing?.hash);
  const code = sent ? Promise.resolve(sent) : /^\/[^/]/.test(drawing?.src ?? '') ? fetch(drawing.src).then((res) => (res.ok ? res.json() : Promise.reject(new Error('its code could not be fetched')))) : null;
  if (!code) return failed('its code was not sent');
  const id = drawing.hash.slice(0, 16);
  const channel = new MessageChannel(), port = channel.port1;
  // How long a picture took, for whoever measures the page: waiting, in the drawing, and on the page.
  const began = performance.now();
  const keys = new Map(), moving = new Set();
  let mounted = false, ended = false;
  // Patches that come before the scene they change (a drawing may start moving at once) wait for it.
  const early = [];
  // The canvas a scene asked for (surface.js): handed to the drawing when it asks for it, and only then.
  let surface = null;
  const end = () => ((ended = true), surface?.end(), port.postMessage({ type: 'end' }), port.close());
  host.endDrawing = end;
  const tell = (key, name) => !ended && port.postMessage({ type: 'event', event: { key, name } });
  const run = (now) => step(moving, now) && requestAnimationFrame(run);
  // What a drawing patches: its marks, and its tip (drawing-tip.js), whose marks are checked as every mark is.
  const tip = tipOf(host);
  const apply = (list) => {
    const all = Array.isArray(list) ? list : [];
    for (const p of all.filter((p) => p && 'tip' in p)) p.tip ? tip.show(keys.get(String(p.tip.key)), build(p.tip.mark, keys, tell)) : tip.hide();
    patch(all.filter((p) => !(p && 'tip' in p)), keys, tell, moving);
  };
  port.onmessage = (ev) => {
    const said = ev.data ?? {};
    // A picture taken off the page is ended: its worker forgets it.
    if (!host.isConnected && mounted) return end();
    try {
      // A scene already mounted from what was kept is the same scene: the worker's is for what comes after (hovering, lighting).
      if (said.type === 'scene' && kept) return;
      if (said.type === 'scene') {
        const got = performance.now();
        mounted = true;
        mount(said.scene ?? {});
        for (const list of early.splice(0)) apply(list);
        if (moving.size) requestAnimationFrame(run);
        scenes.delete(seen);
        scenes.set(seen, said.scene ?? {});
        if (scenes.size > 24) scenes.delete(scenes.keys().next().value);
        performance.measure(`drawing ${drawing.id}`, { start: began, detail: { drawing: Math.round(said.took ?? 0), mount: Math.round(performance.now() - got) } });
      }
      else if (said.type === 'patch' && !mounted) early.push(said.list);
      else if (said.type === 'patch') (apply(said.list), moving.size && requestAnimationFrame(run));
      else if (said.type === 'frame?') requestAnimationFrame((t) => !ended && port.postMessage({ type: 'frame', t }));
      else if (said.type === 'surface?') surface ? surface.give() : port.postMessage({ type: 'surface', none: true });
      else if (said.type === 'surface-frame') surface?.paint(said.image);
      else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
      else if (said.type === 'error') failed(said.message);
    } catch (err) {
      end();
      failed(err.message);
    }
  };
  const { style: _sent, first: opening, ...shown } = answer;
  const { drawing: _code, code: _canvas, ...fields } = style;
  // The titles of the types the picture holds, as this page knows them: a drawing has no registry of its own.
  const types = Object.fromEntries([...new Set((shown.items ?? []).flatMap((i) => [i.type, i.root]).filter(Boolean))].map((t) => [t, typeTitle(t)]));
  const input = { answer: shown, style: plain(fields), types, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
  const seen = `${drawing.hash}
${JSON.stringify(input)}`;
  const kept = scenes.get(seen);
  // Told what to draw before anything else, so what happens on the page waits behind it: the channel keeps it until the worker has the other end.
  port.postMessage({ type: 'start', input });
  // A picture published with its first frame (src/published-frames.ts) has it on screen now; the drawing's own scene
  // takes its place when it answers.
  if (kept) ((mounted = true), mount(kept));
  else if (opening) {
    // Checked as any scene is: one that says what a drawing may not is not drawn, and the drawing draws the picture.
    try {
      mount(opening);
      mounted = true;
    } catch {
      host.replaceChildren();
    }
  }
  code.then((modules) => {
    if (drawings.get(drawing.hash) !== modules || [...drawings.keys()].at(-1) !== drawing.hash) keepDrawing(drawing.hash, modules);
    return loaded(drawing.hash, modules);
  }).then(
    () => {
      if (ended) return;
      sandbox.frame.contentWindow.postMessage({ type: 'picture', hash: drawing.hash }, '*', [channel.port2]);
      const load = sandbox.loads.get(drawing.hash);
      if (load) load.stopped = () => !ended && (end(), failed('It did not answer for 12 seconds and was stopped.'));
    },
    (err) => !ended && failed(err.message),
  );

  // The marks, in the frame every picture has.
  function mount(scene) {
    if (scene.message) return host.replaceChildren(h('div', { class: 'empty' }, String(scene.message)));
    adopt(id, scene.css);
    host.dataset.drawing = id;
    const picture = build(scene.svg, keys, tell);
    const legend = scene.legend ? build(scene.legend, keys, tell) : null;
    const bar = scene.bar ? build(scene.bar, keys, tell) : null;
    // What goes above the picture, beside it and below it (a rail of chapters, what was said), drawn and checked as the
    // rest is. What is beside it shares a row with it, and goes under it where the row has no room for both.
    const [before, aside, after] = [scene.before, scene.aside, scene.after].map((m) => (m ? build(m, keys, tell) : null));
    const beside = (stage) => (aside ? h('div', { class: 'lf-beside' }, stage, aside) : stage);
    // A surface over the picture, if the scene asks for one: a new one with each scene, the last one ended.
    surface?.end();
    surface = scene.surface ? surfaceOf(picture, port, () => colours(host, style)) : null;
    if (surface) keys.set(String(scene.surface.key ?? 'surface'), surface.canvas);
    const over = surface?.canvas;
    const { width, height } = scene.size ?? {};
    const redraw = () => !ended && port.postMessage({ type: 'restyle', style: plain({ ...style, drawing: undefined, code: undefined }) });
    host.redraw = redraw;
    // Read on a published page, a picture holds still: all of it in sight at the width it is given, its key open
    // above it, where it covers no part and no wire.
    if (style.still) {
      legend?.classList.add('still');
      // Its own size is the most it is drawn at: a small picture is not blown up to fill the page.
      picture.setAttribute('width', width);
      picture.setAttribute('height', height);
      return host.replaceChildren(...[before, legend, beside(h('div', { class: 'lf-stage still' }, picture, over)), after].filter(Boolean));
    }
    const lit = litSwitch(answer.viewer, style, keep, redraw);
    const stage = h('div', { class: 'lf-stage', title: 'Scroll to zoom, drag to move' }, picture, over, legend);
    host.replaceChildren(...[before, beside(stage), after].filter(Boolean));
    if (legend) legend.hidden = stage.clientWidth > 0 && stage.clientWidth < sizeOf(style, 'flow_legend_from');
    const moves = panZoom(stage, picture, { width, height, start: scene.start, aside: !legend || legend.hidden ? 0 : legend.offsetWidth + sizeOf(style, 'flow_legend_room') });
    const key = legend && h('button', { class: legend.hidden ? '' : 'on', title: 'What the marks mean', onclick: (ev) => ((legend.hidden = !legend.hidden), ev.currentTarget.classList.toggle('on', !legend.hidden)) }, 'Key');
    const zoom = h(
      'span',
      { class: 'switch' },
      h('button', { title: 'Zoom out', onclick: () => moves.zoomBy(1 / numberOf(style, 'zoom_step')) }, '−'),
      h('button', { title: 'All of it in sight', onclick: () => moves.fit() }, 'Fit'),
      h('button', { title: 'Zoom in', onclick: () => moves.zoomBy(numberOf(style, 'zoom_step')) }, '+'),
    );
    host.prepend(h('div', { class: 'toolbar fold-bar' }, bar, h('span', { class: 'grow' }), lit, key, zoom));
  }
}
