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
// is, and it can say these things back: open this item, show these words by
// the pointer, use this cursor, put a text field here, change the map, and
// what went wrong. A field is this page's own: what is typed in it stays here,
// and the code is told only the field's value. A change goes to the page, which
// sends it as the person looking and the rules judge (src/layout-changes.ts);
// the code is told what came of it. If it stops answering it is ended. Each
// picture gets a new frame, so nothing is left running.
//
// A drawing a pack ships (or the owner's version of one) runs here too, but
// differently: one frame serves every picture on the page, and the drawing
// answers with marks the page checks and mounts, not pixels. That half is
// draw-marks.js, loaded first.
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
  const asking = new Map();
  let asked = 0;
  const size = { width: 0, height: 0, dpr: 1 };
  self.onmessage = async (ev) => {
    const said = ev.data;
    if (said.type === 'ping') return post({ type: 'pong' });
    if (said.type === 'event') {
      if (said.name === 'resize') Object.assign(size, said.event);
      // A new answer, to code that does not listen for one, is drawn again from the start, in a new frame.
      if (said.name === 'answer' && !heard.answer?.length) return post({ type: 'stale' });
      if (said.name === 'changed') {
        const resolve = asking.get(said.event.asked);
        asking.delete(said.event.asked);
        return resolve?.(said.event);
      }
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
      if (typeof made.default !== 'function') throw new Error('The code of a style must export a default function: export default function draw({ canvas, answer, style, theme, size, tree, three, on, open, tip, cursor, field, change }) { … }');
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
        // A text field this page draws over the canvas at { x, y, width, height }, with { value, placeholder, title }; null takes it away. on('field') hears { key, value, done }.
        field: (key, at) => post({ type: 'field', key: String(key), at: at == null ? null : { x: Number(at.x), y: Number(at.y), width: Number(at.width), height: Number(at.height), value: String(at.value ?? ''), placeholder: String(at.placeholder ?? ''), title: String(at.title ?? '') } }),
        // Ops for the page to send as the person looking: resolves to { status, created, proposal, held } or { error }.
        change: (ops, reason) => new Promise((resolve) => (asking.set(++asked, resolve), post({ type: 'change', asked, ops, reason: String(reason ?? '') }))),
      });
      // Its code has returned: once two frames have been painted after it, the view has drawn (ui/look.js).
      const frame = () => new Promise((r) => (self.requestAnimationFrame ? self.requestAnimationFrame(r) : setTimeout(r, 16)));
      await frame();
      await frame();
      post({ type: 'drew' });
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
const mostFields = 24;
const fields = new Map();
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'wheel'];

let worker;
let heldTell = () => undefined;

/** A text field the code asked for, drawn by this page over the canvas: the code hears its value, never a key. */
function place(key, at, theme) {
  let input = fields.get(key);
  if (!at || ![at.x, at.y, at.width, at.height].every(Number.isFinite)) return void (input?.remove(), fields.delete(key));
  if (!input) {
    if (fields.size >= mostFields) return;
    input = document.createElement('input');
    input.className = 'tip field';
    Object.assign(input.style, { background: theme.inner || theme.land, color: theme.text, borderColor: theme.line });
    const said = (done) => heldTell('field', { key, value: input.value.slice(0, 500), done });
    input.addEventListener('input', () => said(false));
    input.addEventListener('change', () => said(true));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    fields.set(key, input);
    document.body.append(input);
  }
  // What the person is typing is theirs: the code's value is put in only while the field is not being typed in.
  if (document.activeElement !== input) input.value = at.value.slice(0, 500);
  Object.assign(input, { placeholder: at.placeholder.slice(0, 100), title: at.title.slice(0, 200) });
  Object.assign(input.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${Math.max(0, at.width)}px`, height: `${Math.max(0, at.height)}px` });
}

/** The picture, started once: a worker that answers, given the canvas and what to draw. */
function start({ code, answer, style, theme }) {
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
    else if (said?.type === 'drew') say({ type: 'drew' });
    else if (said?.type === 'error') fail(said.message);
    else if (said?.type === 'cursor' && CURSORS.includes(said.name)) canvas.style.cursor = said.name;
    else if (said?.type === 'field' && typeof said.key === 'string') place(said.key, said.at, theme);
    else if (said?.type === 'change' && Number.isInteger(said.asked)) say({ type: 'change', asked: said.asked, ops: said.ops, reason: String(said.reason).slice(0, 300) });
    else if (said?.type === 'tip') {
      tip.hidden = said.text == null || !Number.isFinite(said.x) || !Number.isFinite(said.y);
      if (tip.hidden) return;
      tip.textContent = said.text.slice(0, 200);
      tip.style.left = `${Math.max(4, Math.min(said.x + 14, innerWidth - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(4, Math.min(said.y + 14, innerHeight - tip.offsetHeight - 4))}px`;
    }
  };
  // A way slow to answer is not given up (a page reloading is busy, and a worker may take seconds to start): the next
  // is tried beside it, and the first that answers is kept. Only when every way has failed is the code not started.
  const tried = [];
  let failed = 0;
  const lost = () => (++failed >= ways.length ? fail('The code of this style could not be started: this browser lets a sandboxed page start no worker.') : another());
  const another = () => {
    if (started || tried.length >= ways.length) return;
    let mine;
    try {
      mine = ways[tried.length]();
    } catch {
      tried.push(null);
      return lost();
    }
    tried.push(mine);
    const next = setTimeout(another, 1500);
    mine.onerror = () => (clearTimeout(next), mine.terminate(), started || lost());
    mine.onmessage = (ev) => {
      if (!started) {
        // Its first answer says it runs: only now is it given the canvas, which can be handed over once.
        clearTimeout(next);
        started = true;
        worker = mine;
        for (const other of tried) if (other && other !== mine) other.terminate();
        worker.onerror = (err) => fail(err.message || 'The code of this style stopped.');
        worker.postMessage({ type: 'draw', code, answer, style, theme, canvas: surface, ...room() }, [surface]);
      }
      if (mine === worker) hear(ev);
    };
    mine.postMessage({ type: 'ping' });
  };
  another();

  // Where the pointer is and what it does are told to the code; nothing typed ever is, only what a field holds.
  const tell = (name, event) => started && worker.postMessage({ type: 'event', name, event });
  heldTell = tell;
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
  // Code that stops answering is ended: it cannot hold the page, and it is not left to burn. A slow draw is waited for:
  // only a minute of silence ends it. A hidden page is not asked: the browser slows what runs there, so long work is
  // not to be told from code that has stopped.
  const watch = setInterval(() => {
    if (!started || document.hidden) return void (unanswered = 0);
    if (unanswered++ < 30) return void worker.postMessage({ type: 'ping' });
    clearInterval(watch);
    worker.terminate();
    tip.hidden = true;
    fail('It did not answer for a minute and was stopped.');
  }, 2000);
}

addEventListener('message', (ev) => {
  if (ev.source !== parent) return;
  // After the picture starts, the page says only these: a new answer, and what came of a change asked for.
  if (worker && worker !== true && ev.data?.type === 'answer') return void worker.postMessage({ type: 'event', name: 'answer', event: ev.data.answer });
  if (worker && worker !== true && ev.data?.type === 'changed') return void worker.postMessage({ type: 'event', name: 'changed', event: ev.data });
  if (ev.data?.type !== 'draw' || worker) return;
  worker = true;
  // A frame put up while its pane is hidden (a view opened from Home) has no size yet: its code starts once it has one,
  // so it is never handed a canvas of no pixels.
  const sized = () => innerWidth > 0 && innerHeight > 0;
  if (sized()) return start(ev.data);
  const once = () => sized() && (removeEventListener('resize', once), start(ev.data));
  addEventListener('resize', once);
});
say({ type: 'ready' });
