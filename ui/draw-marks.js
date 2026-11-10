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

  // A drawing a pack ships is drawn, where this frame has an origin of its own (the drawing host's, never the page's),
  // by a service worker the host serves for it (/drawing/<hash>/sw.js, around ui/draw-inside.js): the browser keeps
  // it between pages, so a page opened again finds the drawing's code started and already made fast by the runs
  // before. A drawing kept on the map has none (the host answers 404), nor has a frame with no origin: they are drawn
  // by a worker of the frame's own, as is one whose service worker stopped answering here.
  const refused = new Set();
  const served = (hash) =>
    new Promise((resolve, reject) => {
      if (!navigator.serviceWorker || location.origin === 'null' || refused.has(hash) || !/^[\w-]{8,128}$/.test(hash)) return reject(new Error('none'));
      const scope = `/drawing/${hash}/`;
      setTimeout(() => reject(new Error('slow')), 3000);
      navigator.serviceWorker.register(`${scope}sw.js`, { type: 'module', scope }).then((reg) => {
        const active = () => reg.active ?? reg.waiting ?? reg.installing;
        const ready = () => (reg.active ? Promise.resolve() : new Promise((done, fail) => active()?.addEventListener('statechange', (ev) => (ev.target.state === 'activated' ? done() : ev.target.state === 'redundant' && fail(new Error('redundant'))))));
        return ready().then(() => {
          // Its answers come on a channel of the frame's: a service worker has no one to post to.
          const control = new MessageChannel();
          const shim = { onmessage: null, onerror: null, terminate: () => (refused.add(hash), control.port1.close(), reg.unregister()) };
          let first = true;
          shim.postMessage = (message, transfer = []) => {
            const extra = message?.type === 'ping' && first ? [control.port2] : [];
            if (extra.length) first = false;
            active()?.postMessage(message, [...transfer, ...extra]);
          };
          control.port1.onmessage = (ev) => shim.onmessage?.(ev);
          shim.postMessage({ type: 'ping' });
          resolve(shim);
        });
      }, reject).catch(reject);
    });

  const load = (hash, modules) => {
    if (workers.has(hash)) return;
    const w = { unanswered: 0, worker: null, queue: [] };
    workers.set(hash, w);
    const t0 = performance.now();
    served(hash).then(
      (shim) => {
        w.worker = shim;
        shim.onmessage = () => (w.unanswered = 0);
        say({ type: 'loaded', hash, took: performance.now() - t0 });
        w.queue.splice(0).forEach((port) => shim.postMessage({ type: 'picture' }, [port]));
        w.queue = null;
      },
      () => dedicated(hash, modules, w),
    );
  };

  /** The drawing's code in a worker of the frame's own, given its modules. */
  const dedicated = (hash, modules, w) =>
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
