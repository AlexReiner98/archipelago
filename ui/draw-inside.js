// What runs in a drawing's worker, around its code: in the frame's dedicated worker (ui/draw-marks.js hands this
// function over as its text) and in a service worker the drawing host serves for a pack's own drawing
// (/drawing/<hash>/sw.js, which imports the drawing and calls inside(null, made)). Not a module: the frame loads no
// modules, so the server writes this file into the frame's script and into the service worker's (packs/surface/kernel/ui-files.ts).
'use strict';

/**
 * What runs in a worker, around a drawing's code. In a dedicated worker the frame loads the drawing (`load`) and is
 * answered by postMessage. In a service worker the drawing is `given`, imported already, and the frame is answered on
 * the channel of the last ping it sent: a service worker has no one to post to, and may import nothing more.
 */
function inside(home, given) {
  let control = null;
  const post = (message) => (given ? control?.postMessage(message) : self.postMessage(message));
  const text = (err) => String(err?.message ?? err).slice(0, 300);
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  /**
   * How wide a text is drawn, as the page's own canvas would say: each once, since a drawing asks again and again as
   * it cuts a name to fit. Set as a text role (the style's type: weight, style, case, track), it is measured so.
   */
  const widths = new Map();
  let current = '';
  const measure = (words, px, font, as) => {
    const said = as?.case === 'upper' ? String(words).toUpperCase() : String(words);
    const want = `${as?.style === 'italic' ? 'italic ' : ''}${as?.weight === 600 ? 600 : 400} ${px}px ${font || 'system-ui'}`, key = `${want}|${said}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (current !== want) ctx.font = current = want;
      widths.set(key, (w = ctx.measureText(said).width));
      if (widths.size > 50000) widths.clear();
    }
    const track = /^-?\d+(\.\d+)?em$/.test(as?.track ?? '') ? parseFloat(as.track) * px * [...said].length : 0;
    return w + track;
  };
  let made = given;
  // A drawing is a set of modules, entered at index.js; one imports another as './name.js'. Each is given an
  // address of its own (a blob's, else a data address), the ones it imports first.
  const load = (modules, asUrl) => {
    const urls = new Map(), on = new Set();
    const urlOf = (name) => {
      if (urls.has(name)) return urls.get(name);
      if (typeof modules[name] !== 'string') throw new Error(`The drawing imports "${name}", which it does not have`);
      if (on.has(name)) throw new Error(`The drawing's modules import each other in a ring, at "${name}"`);
      on.add(name);
      const code = modules[name].replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+\.js)\2/g, (_, before, q, dep) => `${before}${q}${urlOf(dep)}${q}`);
      urls.set(name, asUrl(code));
      return urls.get(name);
    };
    return import(urlOf('index.js'));
  };
  const blob = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const data = (code) => `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`;

  /**
   * The gesture a drawing opts into (decision e_qpaqnmrc, axis F): a button to add an item on an island. The drawing
   * says which of its marks are islands, and draws the button where `on` gives it events; the page answers it itself
   * (ui/marks-add.js), so nothing is heard here. A session that may not write is given no events, so no button.
   */
  const gesturesOf = (may) => ({ island = () => null } = {}) => {
    const writes = Array.isArray(may) && may.includes('write');
    return { on: (key) => (writes && island(key) ? ['add'] : []), hear: () => false };
  };

  /** One picture, over its own channel. */
  function serve(port) {
    let drawn, ended = false, may = [];
    const waiting = [];
    const send = (message) => !ended && port.postMessage(message);
    // A change asked of the page, answered by number: what came of it, or why not.
    const asked = new Map();
    let asks = 0;
    const change = (ops, reason) => new Promise((resolve) => (asked.set(++asks, resolve), send({ type: 'change', asked: asks, ops, reason: String(reason ?? '') })));
    const tools = {
      change,
      gestures: (spec) => gesturesOf(may)(spec),
      measure,
      patch: (list) => send({ type: 'patch', list }),
      open: (id) => send({ type: 'open', id: String(id) }),
      // The page's next frame: a drawing that moves is moved in time with the page, and not at all while it is hidden.
      frame: () => new Promise((resolve) => (waiting.push(resolve), send({ type: 'frame?' }))),
      // A surface, if its scene asked for one (ui/surface.js): a canvas here to paint, shown over its picture frame by
      // frame (show), its size as it changes, the page's colours and three.js. Null where there is none.
      surface: () => (surface ??= new Promise((resolve) => ((gotSurface = resolve), send({ type: 'surface?' })))),
    };
    let surface, gotSurface;
    const sized = [];
    // A canvas of its own here, the surface's size; each frame painted on it goes to the page as an image (show).
    const paintable = (said) => {
      const canvas = new OffscreenCanvas(1, 1);
      return {
        canvas,
        size: { ...said.size },
        colours: said.colours ?? {},
        // A service worker may not import: a drawing that paints with three.js is drawn by a dedicated worker.
        three: () => (given ? Promise.reject(new Error("three.js is not offered in a service worker")) : import(`${home}/three.js`)),
        resized: (fn) => sized.push(fn),
        show: () => {
          const image = canvas.transferToImageBitmap();
          if (!ended) port.postMessage({ type: 'surface-frame', image }, [image]);
        },
      };
    };
    let ready = Promise.resolve();
    // What is in view comes as often as the plane moves: the drawing is told only the latest, once it is free.
    let view = null;
    port.onmessage = (ev) => {
      const said = ev.data ?? {};
      // What came of a change it asked for is answered at once: the drawing may be waiting on it inside an event.
      if (said.type === 'changed') {
        const { type: _t, asked: n, ...came } = said;
        asked.get(n)?.(came);
        return void asked.delete(n);
      }
      if (said.type === 'start') may = Array.isArray(said.input?.may) ? said.input.may : [];
      if (said.type === 'viewport') {
        const told = view;
        view = Object.fromEntries(['x', 'y', 'width', 'height', 'scale'].map((k) => [k, Number(said.view?.[k]) || 0]));
        if (told) return;
      }
      ready = ready.then(async () => {
        const t0 = performance.now();
        try {
          if (said.type === 'start') {
            drawn = await made.picture(said.input, tools);
            // How many pictures this worker has drawn, for whoever looks into it: a service worker is kept between pages.
            self.pictures = (self.pictures ?? 0) + 1;
            // How long the drawing took, for the page to tell whoever measures it.
            send({ type: 'scene', scene: drawn?.scene ?? {}, took: performance.now() - t0 });
          } else if (said.type === 'event' && drawn?.on) send({ type: 'patch', list: (await drawn.on(said.event)) ?? [], answers: said.event });
          else if (said.type === 'restyle' && drawn?.restyle) send({ type: 'patch', list: (await drawn.restyle(said.style)) ?? [] });
          else if (said.type === 'viewport') {
            const now = view;
            view = null;
            if (drawn?.viewport) send({ type: 'patch', list: (await drawn.viewport(now)) ?? [] });
          } else if (said.type === 'frame') waiting.splice(0).forEach((resolve) => resolve(said.t));
          else if (said.type === 'surface') gotSurface?.(said.none ? null : paintable(said));
          else if (said.type === 'surface-size') sized.forEach((fn) => fn({ ...said.size }));
          else if (said.type === 'end') (drawn?.end?.(), (ended = true), port.close());
        } catch (err) {
          send({ type: 'error', message: text(err) });
        } finally {
          // A picture finished is the worker answering: pictures queued one after another are not a drawing that
          // has stopped, and the count of pings unanswered starts again from each.
          if (said.type === 'start') post({ type: 'pong' });
        }
      });
    };
  }

  const heard = async (ev) => {
    const said = ev.data ?? {};
    if (said.type === 'ping') return given ? ((control = ev.ports[0] ?? control), post({ type: 'pong' })) : post({ type: 'pong' });
    if (said.type === 'warm') return void measure('Warm', 13);
    if (said.type === 'picture') return made && serve(ev.ports[0]);
    if (said.type !== 'load' || made) return;
    const t0 = performance.now();
    try {
      made = await load(said.modules, blob).catch(() => load(said.modules, data));
      if (typeof made.picture !== 'function') throw new Error('A drawing must export a function `picture(input, tools)` that answers with { scene }');
      post({ type: 'loaded', took: performance.now() - t0 });
    } catch (err) {
      made = undefined;
      post({ type: 'error', message: text(err) });
    }
  };
  if (!given) return void (self.onmessage = heard);
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));
  self.addEventListener('message', heard);
}
