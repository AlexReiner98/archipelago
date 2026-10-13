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
      n.you = (me && n.state.waits_on.includes(me) ? 1 : 0) + ((me && n.within.waits_on[me]) || 0);
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
  let answered = Date.now();
  let started = false;
  const hear = ({ data: said }) => {
    answered = Date.now();
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
    if (!started) return void (answered = Date.now());
    worker.postMessage({ type: 'ping' });
    if (Date.now() - answered < 12000) return;
    clearInterval(watch);
    worker.terminate();
    tip.hidden = true;
    fail('It did not answer for 12 seconds and was stopped.');
  }, 2000);
});
say({ type: 'ready' });
