// Where a style's own drawing code runs. Two walls, one inside the other.
//
// This page is a sandboxed frame: an origin of its own, so nothing here can
// reach the token or storage of the page around it, and a policy that loads
// nothing from outside and sends nothing anywhere. No code but this file
// runs in it.
//
// The style's code runs in a worker this page starts, and draws on a canvas
// handed to it. A worker has no page: no elements, no frames or windows to
// make, no WebRTC, nothing typed can reach it. It is told what to draw (a
// lens answer, the style's fields, the page's colours) and where the pointer
// is, and it can say four things back: open this item, show these words by
// the pointer, use this cursor, and what went wrong. If it stops answering
// it is ended. Each picture gets a new frame, so nothing is left running.
//
// A drawing a pack ships (or the owner's version of one) runs here too, but
// differently: one frame serves every picture on the page, and the drawing
// answers with marks the page checks and mounts, not pixels. That half is at
// the end of this file.
'use strict';

const home = new URL(location.href).origin;
const say = (message) => parent.postMessage(message, '*');
const fail = (err) => say({ type: 'error', message: String(err?.message ?? err).slice(0, 300) });

/** What runs in the worker, around the style's code. Written as a function and handed over as its text. */
function inside(home) {
  const post = (message) => self.postMessage(message);
  const fail = (err) => post({ type: 'error', message: String(err?.message ?? err) });
  self.addEventListener('unhandledrejection', (ev) => fail(ev.reason));
  /** A lens answer as a tree, each thing with what it says of itself and of all that is inside it: the same numbers at every depth. */
  const tree = (answer) => {
    const me = answer.viewer;
    const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
    const root = { kids: [], depth: -1, title: 'Everything' };
    for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(Object.assign(n, { up: byId.get(n.inside) ?? root }));
    for (const n of byId.values()) {
      n.all = 1 + n.within.items;
      n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
      n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
      n.work = n.size.work + n.within.work;
      n.at = n.state.sessions + n.within.sessions;
    }
    const deepen = (n, depth) => ((n.depth = depth), n.kids.sort((a, b) => a.place - b.place).forEach((kid) => deepen(kid, depth + 1)));
    deepen(root, -1);
    return { me, byId, root };
  };
  const heard = {};
  const size = { width: 0, height: 0, dpr: 1 };
  self.onmessage = async (ev) => {
    const said = ev.data;
    if (said.type === 'ping') return post({ type: 'pong' });
    if (said.type === 'event') {
      if (said.name === 'resize') Object.assign(size, said.event);
      for (const fn of heard[said.name] ?? []) {
        try {
          fn(said.event);
        } catch (err) {
          fail(err);
        }
      }
      return;
    }
    if (said.type !== 'draw') return;
    Object.assign(size, { width: said.width, height: said.height, dpr: said.dpr });
    try {
      // The code is a module of its own, loaded from its text: by a blob's address where the browser allows that here, else as a data address.
      const made = await import(URL.createObjectURL(new Blob([said.code], { type: 'text/javascript' }))).catch(() => import(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(said.code)))}`));
      if (typeof made.default !== 'function') throw new Error('The code of a style must export a default function: export default function draw({ canvas, answer, style, theme, size, tree, three, on, open, tip, cursor }) { … }');
      await made.default({
        canvas: said.canvas,
        answer: said.answer,
        style: said.style,
        theme: said.theme,
        size,
        tree: () => tree(said.answer),
        three: () => import(`${home}/three.js`),
        on: (name, fn) => (heard[name] ??= []).push(fn),
        open: (id) => post({ type: 'open', id: String(id) }),
        tip: (text, x, y) => post({ type: 'tip', text: text == null ? null : String(text), x: Number(x), y: Number(y) }),
        cursor: (name) => post({ type: 'cursor', name: String(name) }),
      });
    } catch (err) {
      fail(err);
    }
  };
}

const canvas = document.createElement('canvas');
const tip = document.createElement('div');
tip.className = 'tip';
tip.hidden = true;
document.body.append(canvas, tip);
const CURSORS = ['default', 'pointer', 'grab', 'grabbing', 'crosshair', 'move'];
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'wheel'];

let worker;
addEventListener('message', (ev) => {
  if (ev.source !== parent || ev.data?.type !== 'draw' || worker) return;
  const { code, answer, style, theme } = ev.data;
  document.body.style.background = theme.sea;
  Object.assign(tip.style, { background: theme.land, color: theme.text, borderColor: theme.line });
  const room = () => ({ width: innerWidth, height: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) });
  const surface = canvas.transferControlToOffscreen();
  Object.assign(surface, { width: Math.round(room().width * room().dpr), height: Math.round(room().height * room().dpr) });
  // A page with no origin may not start a worker every way a page can, and browsers differ in which: each is tried until one answers.
  const text = `(${inside})(${JSON.stringify(home)})`;
  const ways = [
    () => new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })), { type: 'module' }),
    () => new Worker(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`, { type: 'module' }),
    () => new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))),
    () => new Worker(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`),
  ];
  // How many pings in a row have gone unanswered: counted, not timed, so a page the browser has slowed (a tab left in
  // the background runs its timers once a minute) does not stop code that answers whenever it is asked.
  let unanswered = 0;
  let started = false;
  const hear = ({ data: said }) => {
    unanswered = 0;
    // Only these, and each one checked: what the code says is never trusted.
    if (said?.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) say({ type: 'open', id: said.id });
    else if (said?.type === 'error') fail(said.message);
    else if (said?.type === 'cursor' && CURSORS.includes(said.name)) canvas.style.cursor = said.name;
    else if (said?.type === 'tip') {
      tip.hidden = said.text == null || !Number.isFinite(said.x) || !Number.isFinite(said.y);
      if (tip.hidden) return;
      tip.textContent = said.text.slice(0, 200);
      tip.style.left = `${Math.max(4, Math.min(said.x + 14, innerWidth - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(4, Math.min(said.y + 14, innerHeight - tip.offsetHeight - 4))}px`;
    }
  };
  const begin = (at) => {
    if (at >= ways.length) return fail('The code of this style could not be started: this browser lets a sandboxed page start no worker.');
    let mine;
    try {
      mine = ways[at]();
    } catch {
      return begin(at + 1);
    }
    const next = () => (mine.terminate(), !started && begin(at + 1));
    const giveUp = setTimeout(next, 1500);
    mine.onerror = () => (clearTimeout(giveUp), next());
    mine.onmessage = (ev) => {
      if (!started) {
        // Its first answer says it runs: only now is it given the canvas, which can be handed over once.
        clearTimeout(giveUp);
        started = true;
        worker = mine;
        worker.onerror = (err) => fail(err.message || 'The code of this style stopped.');
        worker.postMessage({ type: 'draw', code, answer, style, theme, canvas: surface, ...room() }, [surface]);
      }
      hear(ev);
    };
    mine.postMessage({ type: 'ping' });
  };
  worker = true;
  begin(0);

  // Where the pointer is and what it does are told to the code; nothing typed ever is.
  const tell = (name, event) => started && worker.postMessage({ type: 'event', name, event });
  for (const name of EVENTS) {
    canvas.addEventListener(
      name,
      (e) => {
        if (name === 'wheel') e.preventDefault();
        if (name === 'pointerdown') canvas.setPointerCapture(e.pointerId);
        tell(name, { x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons, deltaY: e.deltaY ?? 0, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      },
      { passive: false },
    );
  }
  addEventListener('resize', () => tell('resize', room()));
  // Code that stops answering is ended: it cannot hold the page, and it is not left to burn.
  const watch = setInterval(() => {
    if (!started) return void (unanswered = 0);
    if (unanswered++ < 6) return void worker.postMessage({ type: 'ping' });
    clearInterval(watch);
    worker.terminate();
    tip.hidden = true;
    fail('It did not answer for 12 seconds and was stopped.');
  }, 2000);
});
say({ type: 'ready' });

// ---- Drawings that answer with marks (ui/drawing.js) ------------------------------------------------------------
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
    /** How wide a text is drawn, as the page's own canvas would say: each once, since a drawing asks again and again as it cuts a name to fit. */
    const widths = new Map();
    let current = '';
    const measure = (words, px, font) => {
      const want = `400 ${px}px ${font || 'system-ui'}`, key = `${want}|${words}`;
      let w = widths.get(key);
      if (w === undefined) {
        if (current !== want) ctx.font = current = want;
        widths.set(key, (w = ctx.measureText(String(words)).width));
        if (widths.size > 50000) widths.clear();
      }
      return w;
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
      port.onmessage = (ev) => {
        const said = ev.data ?? {};
        ready = ready.then(async () => {
          const t0 = performance.now();
          try {
            if (said.type === 'start') {
              drawn = await made.picture(said.input, tools);
              // How long the drawing took, for the page to tell whoever measures it.
              send({ type: 'scene', scene: drawn?.scene ?? {}, took: performance.now() - t0 });
            } else if (said.type === 'event' && drawn?.on) send({ type: 'patch', list: (await drawn.on(said.event)) ?? [] });
            else if (said.type === 'restyle' && drawn?.restyle) send({ type: 'patch', list: (await drawn.restyle(said.style)) ?? [] });
            else if (said.type === 'frame') waiting.splice(0).forEach((resolve) => resolve(said.t));
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
        if (typeof made.picture !== 'function') throw new Error('A drawing must export a function picture(input, tools) that answers with { scene }');
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
  setInterval(() => {
    for (const [hash, w] of workers) {
      if (!w.worker) continue;
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
