// Where a style's own drawing code runs. Two walls, one inside the other.
//
// This page is a sandboxed frame: an origin of its own, so nothing here can
// reach the token or storage of the page around it, and a policy that loads
// nothing from outside and sends nothing anywhere. No code but this file
// runs in it.
//
// The layout's code runs in a worker this page starts, and draws on a canvas
// handed to it. A worker has no page: no elements, no frames or windows to
// make, no WebRTC, nothing typed can reach it. It is told what to draw (a
// lens answer, the style's fields, the page's colours) and where the pointer
// is, and it can say these things back: open this item, show these words by
// the pointer, use this cursor, put a text field here, change the map, and
// what went wrong. A field is this page's own: what is typed in it stays here,
// and the code is told only the field's value. A change goes to the page, which
// sends it as the person looking and the rules judge (packs/rules/kernel/layout-changes.ts);
// the code is told what came of it. If it stops answering it is ended. New code
// (a try, a change to the layout) is swapped in this same frame: the old worker
// is asked for what it keeps (its module's optional `hot()`), ended, and a new
// one is started on a new canvas, handed that as `hot`. What it keeps stays in
// this frame, and nothing of the old code is left running. Opened, the code cannot
// be ended in this window: the page asks what it keeps and starts a new frame with it.
//
// A drawing a pack ships (or the owner's version of one) runs here too, but
// differently: one frame serves every picture on the page, and the drawing
// answers with marks the page checks and mounts, not pixels. That half is
// draw-marks.js, loaded first.
//
// Where the owner has turned the sandbox off for drawings (drawings_open), the
// page asks for this frame opened (draw.html?open=1): served with no policy but
// who may frame it, in the page's own origin, and the code runs here, in this
// window, not in a worker. It has the network, fonts, files and links, and what
// it puts in `root` (a panel of its own) is in the app's page, over the
// picture, where an agent driving the browser reads it.
'use strict';

const home = new URL(location.href).origin;
const opened = document.documentElement.dataset.drawOpen === 'on';
const say = (message) => parent.postMessage(message, '*');
const fail = (err) => say({ type: 'error', message: String(err?.message ?? err).slice(0, 300) });

/**
 * What runs in the worker, around the layout's code. Written as a function and handed over as its text; opened, run in
 * this window instead, over a channel (`port`), given the canvas and the body it draws in (`given`).
 */
function inside(home, port, given) {
  const me = port ?? self;
  const post = (message, moved = []) => me.postMessage(message, moved);
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
  // A module from its text: by a blob's address where the browser allows that here, else as a data address.
  const blob = (text) => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const data = (text) => `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
  /**
   * The code, loaded: one text is one module; files by path are linked from index.js, each './name.js' it imports
   * made the address of that file, as a pack drawing's modules are (draw-inside.js). Nothing else can be imported.
   */
  const load = async (code) => {
    if (typeof code === 'string') return import(blob(code)).catch(() => import(data(code)));
    const link = (asUrl) => {
      const urls = new Map(), on = new Set();
      const urlOf = (name) => {
        if (urls.has(name)) return urls.get(name);
        if (typeof code?.[name] !== 'string') throw new Error(`The code imports "${name}", which it does not have: its files are ${Object.keys(code ?? {}).join(', ')}`);
        if (on.has(name)) throw new Error(`The code's files import each other in a ring, at "${name}"`);
        on.add(name);
        urls.set(name, asUrl(code[name].replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+\.js)\2/g, (_, before, q, dep) => `${before}${q}${urlOf(dep)}${q}`)));
        return urls.get(name);
      };
      return import(urlOf('index.js'));
    };
    return link(blob).catch((err) => (/imports|ring/.test(err?.message ?? '') ? Promise.reject(err) : link(data)));
  };
  /**
   * Baked (task e_muh2979u): the code paints once on a canvas that keeps shapes (draw-record.js), and each time it holds
   * a finished picture says so with bake(name); bake(null, { every, fade }) ends it, saying how the pictures turn. Only in a worker: a picture painted aside
   * (an OffscreenCanvas) is recorded too, so the worker's own is put by.
   */
  const bake = async (said) => {
    if (given) return post({ type: 'error', message: 'A drawing is baked in a worker, walled in' });
    const kept = {}, most = 64;
    // How the pictures turn, said as it ends: seconds each, and whether each fades into the next.
    let timing = { every: 1, fade: false };
    let ended, bakedAny = false;
    const over = new Promise((resolve) => (ended = resolve));
    // Quiet for 15 seconds, it is over: what it baked is kept, and code that never says bake is told it does not know how.
    let late;
    const quiet = () => (clearTimeout(late), (late = setTimeout(() => ended(bakedAny ? undefined : new Error('This code bakes nothing: it never calls bake(name)')), 15000)));
    try {
      const rec = record(new OffscreenCanvas(1, 1).getContext('2d'));
      self.OffscreenCanvas = rec.Canvas;
      const canvas = new rec.Canvas(said.width, said.height);
      made = await load(said.code);
      if (typeof made.default !== 'function') throw new Error('The code of a style must export a default function');
      const no = () => undefined;
      await made.default({
        canvas, root: null, sandboxed: true, answer: said.answer, style: { ...said.style, still: true, bake: true }, theme: said.theme,
        size: { width: said.width, height: said.height, dpr: 1 }, tree: () => tree(said.answer),
        three: () => Promise.reject(new Error('A baked drawing is painted on a 2D canvas')), on: no, open: no, tip: no, cursor: no, field: no,
        change: () => Promise.resolve({ error: 'A drawing being baked may not change the map' }),
        bake: (name, how) => {
          quiet();
          if (name == null) return ((timing = { every: Math.max(0.2, Math.min(60, Number(how?.every) || 1)), fade: how?.fade === true }), ended());
          if (Object.keys(kept).length >= most) throw new Error(`A drawing bakes at most ${most} looks`);
          bakedAny = true;
          kept[String(name).slice(0, 60)] = rec.shapes(canvas);
        },
      });
      quiet();
      const why = await over;
      clearTimeout(late);
      if (why) throw why;
      // One drawing in many colours: its outlines once, and each look's colours in their order. A look whose outlines
      // differ is not one of them, and is said so here, before anything is sent.
      const names = Object.keys(kept), first = kept[names[0]];
      if (!first) throw new Error('This code baked no look');
      const outline = (pic) => JSON.stringify([pic.width, pic.height, pic.clips, pic.shapes.map(({ c: _c, ...rest }) => rest)]);
      const same = outline(first), looks = {};
      for (const name of names) {
        if (outline(kept[name]) !== same) throw new Error(`${name} is not the same drawing as ${names[0]} in other colours`);
        looks[name] = kept[name].shapes.map((s) => s.c);
      }
      post({ type: 'baked', baking: { width: first.width, height: first.height, clips: first.clips, shapes: first.shapes, looks, timing } });
    } catch (err) {
      fail(err);
    }
  };
  const heard = {};
  // The page around a backdrop (packs/walls/page/backdrop.js): the latest it said, handed to code that listens late.
  let pageLast = null;
  const call = (fn, event) => { try { fn(event); } catch (err) { fail(err); } };
  const asking = new Map();
  let asked = 0;
  const size = { width: 0, height: 0, dpr: 1 };
  let made;
  me.onmessage = async (ev) => {
    const said = ev.data;
    if (said.type === 'ping') return post({ type: 'pong' });
    // New code is coming: what this code keeps (its camera, its pins), if it says, for the code after it.
    if (said.type === 'hot') {
      let state;
      try {
        state = typeof made?.hot === 'function' ? await made.hot() : undefined;
        return post({ type: 'hot', state });
      } catch (err) {
        post({ type: 'hot' });
        return fail(`What hot() kept could not be handed on: ${err?.message ?? err}`);
      }
    }
    if (said.type === 'event') {
      if (said.name === 'resize') Object.assign(size, said.event);
      if (said.name === 'page') pageLast = said.event;
      // A new answer, to code that does not listen for one, is drawn again from the start, in a new frame.
      if (said.name === 'answer' && !heard.answer?.length) return post({ type: 'stale' });
      if (said.name === 'changed') {
        const resolve = asking.get(said.event.asked);
        asking.delete(said.event.asked);
        return resolve?.(said.event);
      }
      for (const fn of heard[said.name] ?? []) call(fn, said.event);
      return;
    }
    if (said.type === 'bake') return bake(said);
    if (said.type !== 'draw') return;
    Object.assign(size, { width: said.width, height: said.height, dpr: said.dpr });
    const pageGiven = (pageLast = said.page ?? pageLast);
    try {
      // The code is a module of its own (or files linked from index.js), loaded from its text.
      made = await load(said.code);
      if (typeof made.default !== 'function') throw new Error('The code of a style must export a default function: export default function draw({ canvas, answer, style, theme, size, tree, three, on, open, tip, cursor, field, change, sandboxed, root }) { … }. An item in answer has its values under fields; a change writes them as props.');
      await made.default({
        canvas: given?.canvas ?? said.canvas,
        // Opened, an element of the app's page over the picture, for a panel of its own; walled in, there is none.
        root: given?.root ?? null,
        sandboxed: !given,
        answer: said.answer,
        style: said.style,
        theme: said.theme,
        // What the code before it in this frame kept (its hot()), or undefined.
        hot: said.hot,
        size,
        // Run as a page's backdrop: its size, scroll and the boxes of its words, or null; and whether its reader asks for less motion.
        page: pageGiven, reducedMotion: pageGiven?.reducedMotion === true,
        tree: () => tree(said.answer),
        three: () => import(`${home}/three.js`),
        // What a backdrop's page said while the code was loading, after it was handed `page`, is not lost.
        on: (name, fn) => ((heard[name] ??= []).push(fn), name === 'page' && setTimeout(() => pageLast && pageLast !== pageGiven && call(fn, pageLast))),
        // A backdrop that draws more than the window says, after each frame, the page height its canvas's top stands at: that frame is shown there, scrolling with the page's words (draw-scroll.js).
        drawn: (top) => pageGiven && Number.isFinite(Number(top)) && said.canvas?.transferToImageBitmap && ((b) => post({ type: 'frame', bitmap: b, top: Number(top) }, [b]))(said.canvas.transferToImageBitmap()),
        look: (colours) => pageGiven && post({ type: 'look', look: Object.fromEntries(Object.entries(colours ?? {}).map(([k, v]) => [String(k), String(v)])) }),
        // An item's id, or opened, an https address too.
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

const tip = document.createElement('div');
tip.className = 'tip';
tip.hidden = true;
document.body.append(tip);
const CURSORS = ['default', 'pointer', 'grab', 'grabbing', 'crosshair', 'move'];
const mostFields = 24;
const fields = new Map();
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'wheel'];

let worker;
let heldTell = () => undefined;
/** The picture running: what it keeps, and how it is ended (start). */
let current;
/** The longest new code waits for what the old keeps: code that does not answer by then hands on nothing. */
const keptWait = 1000;

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

/** The latest the page around a backdrop said of itself (packs/walls/page/backdrop.js), checked, for code started after it. */
let pageNow = null;
/** The pictures of a backdrop that says where on the page it drew them (landing, draw-scroll.js), once one has come. */
let landed;

/** What runs in a worker, around the code: the recording canvas (draw-record.js) and `inside`. */
const text = `${record}
(${inside})(${JSON.stringify(home)})`;
/** A page with no origin may not start a worker every way a page can, and browsers differ in which: each is tried until one answers. */
const walled = [
  () => new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })), { type: 'module' }),
  () => new Worker(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`, { type: 'module' }),
  () => new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))),
  () => new Worker(`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`),
];

/**
 * A picture baked, once, in a worker walled in whether or not the page opened this frame: the pictures its code said
 * were finished, as shapes, to the page (`baked`), or what went wrong. The frame is the page's to put away after.
 */
async function bakeOnce(said) {
  for (const way of walled) {
    let mine;
    try {
      mine = way();
    } catch {
      continue;
    }
    const answered = await new Promise((resolve) => {
      const late = setTimeout(() => resolve(false), 3000);
      mine.onerror = () => (clearTimeout(late), resolve(false));
      mine.onmessage = () => (clearTimeout(late), resolve(true));
      mine.postMessage({ type: 'ping' });
    });
    if (!answered) {
      mine.terminate();
      continue;
    }
    mine.onerror = (err) => (mine.terminate(), fail(err.message || 'The code of this style stopped.'));
    mine.onmessage = ({ data }) => {
      if (data?.type === 'baked') (mine.terminate(), say({ type: 'baked', baking: data.baking }));
      else if (data?.type === 'error') (mine.terminate(), fail(data.message));
    };
    const { code, answer, style, theme, width, height } = said;
    return void mine.postMessage({ type: 'bake', code, answer, style, theme, width: Number(width) || 1200, height: Number(height) || 630 });
  }
  fail('The code of this style could not be started: this browser lets a sandboxed page start no worker.');
}

/** The picture, started once: a worker that answers, given the canvas and what to draw. */
function start({ code, answer, style, theme, hot }) {
  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  let ended = false;
  let keeping;
  document.body.style.background = theme.sea;
  Object.assign(tip.style, { background: theme.land, color: theme.text, borderColor: theme.line });
  const room = () => ({ width: innerWidth, height: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) });
  // Opened, the code draws on the canvas itself; walled in, on one handed to its worker, which can be handed over once.
  const surface = opened ? canvas : canvas.transferControlToOffscreen();
  Object.assign(surface, { width: Math.round(room().width * room().dpr), height: Math.round(room().height * room().dpr) });
  // A page with no origin may not start a worker every way a page can, and browsers differ in which: each is tried until one answers.
  const inPage = () => {
    const { port1, port2 } = new MessageChannel();
    addEventListener('error', (ev) => fail(ev.error ?? ev.message));
    inside(home, port2, { canvas, root: frameElement?.parentElement?.querySelector(':scope > .code-panel') ?? document.body });
    return Object.assign(port1, { terminate: () => port1.close() });
  };
  const ways = opened ? [inPage] : walled;
  // How many pings in a row have gone unanswered: counted, not timed, so a page the browser has slowed (a tab left in
  // the background runs its timers once a minute) does not stop code that answers whenever it is asked.
  let unanswered = 0;
  let started = false;
  const hear = ({ data: said }) => {
    unanswered = 0;
    if (said?.type === 'hot') return void keeping?.(said.state);
    // Only these, and each one checked: what the code says is never trusted.
    if (said?.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) say({ type: 'open', id: said.id });
    else if (said?.type === 'open' && opened && /^https:\/\/\S+$/.test(said.id)) open(said.id, '_blank', 'noopener');
    else if (said?.type === 'drew') say({ type: 'drew' });
    else if (said?.type === 'frame' && said.bitmap instanceof ImageBitmap && Number.isFinite(said.top)) (landed ??= landing(() => (canvas.style.visibility = 'hidden'))).show(said);
    else if (said?.type === 'look' && pageNow) say({ type: 'look', look: lookSaid(said.look) });
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
    if (started || ended || tried.length >= ways.length) return;
    let mine;
    try {
      mine = ways[tried.length]();
    } catch {
      tried.push(null);
      return lost();
    }
    tried.push(mine);
    const next = setTimeout(another, 1500);
    mine.onerror = () => (clearTimeout(next), mine.terminate(), started || ended || lost());
    mine.onmessage = (ev) => {
      if (!started) {
        // Its first answer says it runs: only now is it given the canvas, which can be handed over once.
        clearTimeout(next);
        started = true;
        worker = mine;
        for (const other of tried) if (other && other !== mine) other.terminate();
        worker.onerror = (err) => fail(err.message || 'The code of this style stopped.');
        if (opened) worker.postMessage({ type: 'draw', code, answer, style, theme, hot, page: pageNow, ...room() });
        else worker.postMessage({ type: 'draw', code, answer, style, theme, hot, page: pageNow, canvas: surface, ...room() }, [surface]);
      }
      if (mine === worker) hear(ev);
    };
    mine.postMessage({ type: 'ping' });
  };
  another();

  // Where the pointer is and what it does are told to the code; nothing typed ever is, only what a field holds.
  const tell = (name, event) => started && !ended && worker.postMessage({ type: 'event', name, event });
  heldTell = tell;
  for (const name of EVENTS) {
    canvas.addEventListener(
      name,
      (e) => {
        if (name === 'wheel') e.preventDefault();
        if (name === 'pointerdown') canvas.setPointerCapture(e.pointerId);
        tell(name, { x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons, deltaY: e.deltaY ?? 0, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, id: e.pointerId ?? 0, kind: e.pointerType ?? 'mouse' });
      },
      { passive: false },
    );
  }
  const resized = () => tell('resize', room());
  addEventListener('resize', resized);
  // Code that stops answering is ended: it cannot hold the page, and it is not left to burn. A slow draw is waited for:
  // only a minute of silence ends it. A hidden page is not asked: the browser slows what runs there, so long work is
  // not to be told from code that has stopped. Opened, the code shares this page's one thread: nothing here runs while it does.
  const watch = setInterval(() => {
    if (opened) return void clearInterval(watch);
    if (!started || document.hidden) return void (unanswered = 0);
    if (unanswered++ < 30) return void worker.postMessage({ type: 'ping' });
    clearInterval(watch);
    worker.terminate();
    tip.hidden = true;
    fail('It did not answer for a minute and was stopped.');
  }, 2000);
  return {
    // What this code keeps for the next: its hot(), asked of it and waited for a while; nothing where it has none.
    keep: () =>
      new Promise((resolve) => {
        if (!started) return resolve(undefined);
        const late = setTimeout(() => resolve(undefined), keptWait);
        keeping = (state) => (clearTimeout(late), (keeping = undefined), resolve(state));
        worker.postMessage({ type: 'hot' });
      }),
    // Ended: its worker, every way tried, its canvas, its fields and its listeners, so nothing of it is left running.
    stop: () => {
      ended = true;
      clearInterval(watch);
      removeEventListener('resize', resized);
      for (const way of tried) way?.terminate();
      canvas.remove();
      landed = landed?.end();
      for (const input of fields.values()) input.remove();
      fields.clear();
      tip.hidden = true;
    },
  };
}

/** New code waiting to be swapped in, while one is. */
let swapping;
/** What the picture starts with, once its pane has a size. */
let queued;
/** New code for the picture running: swapped in this frame, handed what the old kept. Opened, the page draws a new frame instead. */
async function swap(next) {
  if (opened) return;
  // Code sent while the last is still being swapped in waits, and only the latest is drawn.
  if (swapping) return void (swapping = next);
  // A picture not started yet (its pane has no size) starts with the latest code.
  if (!current) return void (queued &&= { ...queued, ...next });
  swapping = next;
  while (swapping) {
    const was = current;
    const now = swapping;
    const hot = await was.keep();
    was.stop();
    worker = true;
    current = start({ ...now, hot });
    if (swapping === now) swapping = undefined;
  }
}

addEventListener('message', (ev) => {
  if (ev.source !== parent) return;
  // After the picture starts, the page says only these: a new answer, and what came of a change asked for.
  if (worker && worker !== true && ev.data?.type === 'answer') return void worker.postMessage({ type: 'event', name: 'answer', event: ev.data.answer });
  if (worker && worker !== true && ev.data?.type === 'changed') return void worker.postMessage({ type: 'event', name: 'changed', event: ev.data });
  // A backdrop's page, said at any time: kept for code started later, and told to code running.
  if (ev.data?.type === 'page') return void ((pageNow = pageOf(ev.data.page)), worker && worker !== true && pageNow && worker.postMessage({ type: 'event', name: 'page', event: pageNow }));
  // The page scrolls this frame with its words now, its top at this height of the page (draw-scroll.js).
  if (ev.data?.type === 'scrolling') return void landed?.placed(Number(ev.data.top));
  // A page that started this frame before it listened (the frame in ui/index.html) asks whether it is ready.
  if (ev.data?.type === 'ready?') return void say({ type: 'ready' });
  if (ev.data?.type === 'swap') return void swap(ev.data);
  if (ev.data?.type === 'bake' && !worker) return void ((worker = true), bakeOnce(ev.data));
  // Opened, the page asks what the code keeps, for the frame that replaces this one; walled in, it never leaves here.
  if (ev.data?.type === 'keep' && opened) return void (current?.keep() ?? Promise.resolve()).then((state) => {
    try {
      say({ type: 'kept', state });
    } catch {
      say({ type: 'kept' });
    }
  });
  if (ev.data?.type !== 'draw' || worker) return;
  worker = true;
  // A frame put up while its pane is hidden (a view opened from Home) has no size yet: its code starts once it has one,
  // so it is never handed a canvas of no pixels.
  const sized = () => innerWidth > 0 && innerHeight > 0;
  queued = ev.data;
  if (sized()) return void (current = start(queued));
  const once = () => sized() && (removeEventListener('resize', once), (current = start(queued)));
  addEventListener('resize', once);
});
say({ type: 'ready' });
