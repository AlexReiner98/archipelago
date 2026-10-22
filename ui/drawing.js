// A picture drawn by a drawing: code a pack ships or the map keeps (a style's `drawing`), run in the sandbox
// (draw.html, draw-marks.js), answering with marks the page checks and mounts (marks.js). The page keeps what every
// picture has around its marks: the stage that pans and zooms, the key, the bar with the lit switch and zoom, a
// published page's still frame. One frame serves every picture on the page and is started before it is needed;
// each drawing's code is sent once and kept by its hash.

import { h } from './base.js';
import { build, cssFor, patch, step } from './marks.js';
import { litSwitch, numberOf, sizeOf } from './lens-base.js';
import { panZoom } from './pan-zoom.js';

/** Each drawing's modules, by its hash: a lens answer leaves out those the page already has (`have`). */
export const drawings = new Map();
const sheets = new Map();
let sandbox;

/** The frame every drawing runs in, started once: before a picture asks, wherever one may be drawn. */
export function warmDrawings() {
  if (sandbox) return sandbox;
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
  document.body.append(frame);
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

/** Draw the answer in host with the drawing its style names. The same call as any of the kernel's shapes. */
export function drawWith(host, answer, style, keep) {
  host.endDrawing?.();
  const { drawing } = style;
  const modules = drawing?.modules ?? drawings.get(drawing?.hash);
  const failed = (message) => host.replaceChildren(h('div', { class: 'lens-error' }, `This drawing stopped: ${String(message).slice(0, 300)}`));
  if (!modules) return failed('its code was not sent');
  drawings.set(drawing.hash, modules);
  const id = drawing.hash.slice(0, 16);
  const channel = new MessageChannel(), port = channel.port1;
  // How long a picture took, for whoever measures the page: waiting, in the drawing, and on the page.
  const began = performance.now();
  const keys = new Map(), moving = new Set();
  let mounted = false, ended = false;
  const end = () => ((ended = true), port.postMessage({ type: 'end' }), port.close());
  host.endDrawing = end;
  const tell = (key, name) => !ended && port.postMessage({ type: 'event', event: { key, name } });
  const run = (now) => step(moving, now) && requestAnimationFrame(run);
  port.onmessage = (ev) => {
    const said = ev.data ?? {};
    // A picture taken off the page is ended: its worker forgets it.
    if (!host.isConnected && mounted) return end();
    try {
      if (said.type === 'scene') {
        const got = performance.now();
        mounted = true;
        mount(said.scene ?? {});
        performance.measure(`drawing ${drawing.id}`, { start: began, detail: { drawing: Math.round(said.took ?? 0), mount: Math.round(performance.now() - got) } });
      }
      else if (said.type === 'patch') (patch(said.list, keys, tell, moving), moving.size && requestAnimationFrame(run));
      else if (said.type === 'frame?') requestAnimationFrame((t) => !ended && port.postMessage({ type: 'frame', t }));
      else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
      else if (said.type === 'error') failed(said.message);
    } catch (err) {
      end();
      failed(err.message);
    }
  };
  const { style: _sent, ...shown } = answer;
  const { drawing: _code, code: _canvas, ...fields } = style;
  loaded(drawing.hash, modules).then(
    () => {
      if (ended) return;
      sandbox.frame.contentWindow.postMessage({ type: 'picture', hash: drawing.hash }, '*', [channel.port2]);
      port.postMessage({ type: 'start', input: { answer: shown, style: plain(fields), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches } });
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
      return host.replaceChildren(...[legend, h('div', { class: 'lf-stage still' }, picture)].filter(Boolean));
    }
    const lit = litSwitch(answer.viewer, style, keep, redraw);
    const stage = h('div', { class: 'lf-stage', title: 'Scroll to zoom, drag to move' }, picture, legend);
    host.replaceChildren(stage);
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
