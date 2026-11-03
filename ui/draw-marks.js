// Where a drawing a pack ships (or the owner's version of one) runs, in the frame draw.html makes (draw.js has the
// walls): drawings that answer with marks (ui/layout.js), not pixels. Loaded before draw.js, which says the frame is
// ready, so nothing the page sends finds it not yet listening.
'use strict';

// One frame for the whole page, and in it one worker for each drawing's code, kept while the page is open, so a
// second picture drawn by the same code starts at once. The walls are the same: the frame has an origin of its own
// and may send nothing anywhere; the worker has no page. Each picture talks to its worker over a channel of its own, which the page hands in here:
// what it is shown goes in, marks and patches come out, and the page checks every one (ui/marks.js).

(() => {
  const home = new URL(location.href).origin;
  const say = (message) => parent.postMessage(message, '*');

  /** What runs in a worker, around a drawing's code. Written as a function and handed over as its text. */
  function inside(home) {
    const post = (message) => self.postMessage(message);
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
    let made;
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

    /** One picture, over its own channel. */
    function serve(port) {
      let drawn, ended = false;
      const waiting = [];
      const send = (message) => !ended && port.postMessage(message);
      const tools = {
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
          three: () => import(`${home}/three.js`),
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
          }
        });
      };
    }

    self.onmessage = async (ev) => {
      const said = ev.data ?? {};
      if (said.type === 'ping') return post({ type: 'pong' });
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
  }

  // A page with no origin may not start a worker every way a page can, and browsers differ in which: each is tried until one answers.
  const source = `(${inside})(${JSON.stringify(home)})`;
  // A classic worker first: it starts at once where a module worker from a blob is refused, and imports the drawing all the same.
  const WAYS = [
    () => new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))),
    () => new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' }),
    () => new Worker(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(source)))}`),
  ];
  const start = (at = 0) =>
    new Promise((resolve, reject) => {
      if (at >= WAYS.length) return reject(new Error('This browser lets a sandboxed page start no worker.'));
      let mine;
      try {
        mine = WAYS[at]();
      } catch {
        return start(at + 1).then(resolve, reject);
      }
      const next = () => (mine.terminate(), start(at + 1).then(resolve, reject));
      const giveUp = setTimeout(next, 1500);
      mine.onerror = () => (clearTimeout(giveUp), next());
      mine.onmessage = () => (clearTimeout(giveUp), (mine.onerror = null), resolve(mine));
      mine.postMessage({ type: 'ping' });
    });

  /** Each drawing's worker, by the hash of its code. */
  const workers = new Map();
  // One worker is kept started and warm, so the first picture of a drawing waits for no worker to start. The
  // next is started as soon as one is taken.
  let spare;
  const spareOne = () => {
    spare = start().then((worker) => (worker.postMessage({ type: 'warm' }), worker));
    spare.catch(() => (spare = undefined));
  };
  const take = () => {
    const one = spare ?? start();
    spareOne();
    return one;
  };
  spareOne();

  const load = (hash, modules) => {
    if (workers.has(hash)) return;
    const w = { unanswered: 0, worker: null, queue: [] };
    workers.set(hash, w);
    take().then(
      (worker) => {
        w.worker = worker;
        worker.onmessage = ({ data: said }) => {
          w.unanswered = 0;
          // Once loaded, it takes the pictures that waited, and every one after at once.
          if (said?.type === 'loaded') (say({ type: 'loaded', hash, took: said.took }), w.queue.splice(0).forEach((port) => worker.postMessage({ type: 'picture' }, [port])), (w.queue = null));
          else if (said?.type === 'error') (workers.delete(hash), worker.terminate(), say({ type: 'failed', hash, message: String(said.message).slice(0, 300) }));
        };
        worker.onerror = (err) => (workers.delete(hash), worker.terminate(), say({ type: 'failed', hash, message: err.message || 'The drawing stopped.' }));
        worker.postMessage({ type: 'load', modules });
      },
      (err) => (workers.delete(hash), say({ type: 'failed', hash, message: err.message })),
    );
  };

  addEventListener('message', (ev) => {
    if (ev.source !== parent) return;
    const said = ev.data ?? {};
    if (typeof said.hash !== 'string') return;
    if (said.type === 'load' && said.modules && typeof said.modules === 'object') load(said.hash, said.modules);
    else if (said.type === 'picture' && ev.ports[0]) {
      const w = workers.get(said.hash);
      if (!w) return;
      if (w.worker && !w.queue) w.worker.postMessage({ type: 'picture' }, [ev.ports[0]]);
      else w.queue.push(ev.ports[0]);
    }
  });
  // Code that stops answering is ended: it cannot hold the page, and it is not left to burn. Pings unanswered are
  // counted, not timed: a page the browser has slowed in the background is asked less often, and is not stopped for it.
  // A hidden page is not asked at all, for the browser slows the worker too, and the count starts again when it is seen.
  setInterval(() => {
    for (const [hash, w] of workers) {
      if (!w.worker) continue;
      if (document.hidden) {
        w.unanswered = 0;
        continue;
      }
      if (w.unanswered++ < 6) {
        w.worker.postMessage({ type: 'ping' });
        continue;
      }
      w.worker.terminate();
      workers.delete(hash);
      say({ type: 'stopped', hash, message: 'It did not answer for 12 seconds and was stopped.' });
    }
  }, 2000);
})();
