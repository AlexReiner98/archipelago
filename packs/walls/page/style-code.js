// A layout's code: the drawing a person or an agent wrote for their own project.
//
// Runtime, not a part (rule e_6d2g62tg, task e_u2phc9rq): the page side of a layout's wall, it mounts the walled frame
// a layout's code runs in and hears it, which a worker never can. It says what came of a drawing as look mode hears
// it (a view-drawn event, as ui/look.js says it), so it imports nothing of the app.

import { api, authHeaders, call, drawingsOpen, frameSandbox, h, may, tell } from './base.js';
import { STYLE_COLORS, litSwitch } from './query-base.js';

/** Say on `el` how its drawing went, as look mode listens for it (ui/look.js, saidDrawn). */
const saidDrawn = (el, state, why) => el.dispatchEvent(new CustomEvent('view-drawn', { bubbles: true, detail: { state, why } }));

/** The frame's address (named with the UI's version as it is served), asked for opened. */
const opened = (frame) => ((frame = new URL(frame, location.href)), frame.searchParams.set('open', '1'), frame.pathname + frame.search);

/** Whether a layout's code is there to run: one text, or files by path entered at index.js. */
export const coded = (code) => (typeof code === 'string' && code.trim() !== '') || (!!code && typeof code === 'object' && typeof code['index.js'] === 'string');

/** The most ops one ask of a drawing may carry. */
const mostOps = 50;

/** The longest an opened frame is waited for to say what its code kept, before a new frame starts with nothing. */
const keptWait = 1000;

/**
 * A layout's code is the drawing: the page runs it in a
 * frame that is sandboxed (an origin of its own, nothing loaded from outside,
 * nothing sent anywhere), or opened where the owner turned that off, hands it the lens answer, the style's fields and the
 * page's colours, and listens for three things: open this item, change the map
 * (sent here as the person, naming the layout whose code asked, `coder`, for the
 * rules to judge: packs/rules/kernel/layout-changes.ts), and what went wrong. A new answer
 * for the same code and fields goes to the frame already running, when its code listens
 * for one; new code or fields go to it too, and the new code is handed what the old kept
 * (its `hot()`), so a try keeps the view. Walled in, the frame swaps the code in itself and
 * what was kept never reaches this page (packs/walls/page/draw.js). Opened, the code shares
 * its frame's window and cannot be ended there: what it kept is asked of it, and a new frame
 * is handed that. With no frame drawing yet, a new frame.
 */
export function drawCode(host, answer, style, keep, _place, coder) {
  const { code, ...fields } = style;
  const { style: _kept, ...data } = answer;
  const was = host.coded;
  const warm = was?.sent && was.frame?.isConnected && host.contains(was.frame);
  if (warm && JSON.stringify(was.code) === JSON.stringify(code) && JSON.stringify(fields) === was.fields) return void ((was.data = data), was.frame.contentWindow.postMessage({ type: 'answer', answer: data }, '*'));
  if (warm) return void (Object.assign(was, { code, fields: JSON.stringify(fields), style: fields, data, keep, coder }), was.swap());
  const error = h('div', { class: 'lens-error', hidden: true });
  const stage = h('div', { class: 'code-stage' });
  const colours = () => Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(host).getPropertyValue(`--ln-${name}`).trim()]));
  if (host.coded) window.removeEventListener('message', host.coded.hear);
  // What the frame draws, kept where a swap changes it: every message below reads it from here.
  const run = (host.coded = { code, fields: JSON.stringify(fields), style: fields, data, keep, coder, frame: undefined, hear: undefined, sent: false, open: false });
  const drawing = () => ({ code: run.code, answer: run.data, style: run.style, theme: { ...colours(), dark: matchMedia('(prefers-color-scheme: dark)').matches } });
  // New code to the frame already drawing, which swaps it in; opened, a new frame handed what the old kept; with none, a new frame.
  run.swap = () => {
    if (!run.sent || !run.frame?.isConnected) return draw();
    error.hidden = true;
    if (!run.open) return run.frame.contentWindow.postMessage({ type: 'swap', ...drawing() }, '*');
    // Asked once: code sent while it is asked is drawn by the frame that follows, which reads the latest.
    if (run.keeping) return;
    run.keeping = setTimeout(() => ((run.keeping = undefined), draw()), keptWait);
    run.frame.contentWindow.postMessage({ type: 'keep' }, '*');
  };
  const shown = (said) => ((error.textContent = said), (error.title = said), (error.hidden = false), saidDrawn(host, 'error', said));
  // Where the owner turned the sandbox off (drawingsOpen), the frame is opened: the page's own origin, and no policy.
  const draw = (tries = 0) => drawingsOpen().then((open) => run === host.coded && put(open, tries));
  const put = (open, tries) => {
    error.hidden = true;
    Object.assign(run, { open, sent: false });
    run.frame = h('iframe', { class: 'lens-frame', sandbox: open ? null : frameSandbox(), src: open ? opened('/draw.html') : '/draw.html', title: 'The map, drawn by this style' });
    // Opened, what the code puts in `root` is in this page, over its picture, where an agent driving the browser reads it.
    stage.replaceChildren(run.frame, ...(open ? [h('div', { class: 'code-panel' })] : []));
    // A frame not ready in a while (a page reloading is busy) is put up again, twice; one that is still not ready was not
    // let in by the browser: say so, not a blank. Waited for while the page is hidden, since the browser holds it back then.
    const mine = run.frame;
    const check = () => {
      if (mine !== run.frame || mine.ready || !host.isConnected) return;
      if (document.hidden) return void setTimeout(check, 5000);
      if (tries < 2) return draw(tries + 1);
      shown('The browser did not start the frame this layout runs in.');
    };
    setTimeout(check, 5000);
  };
  // What the drawing asked for, sent as the person looking; what came of it goes back to the drawing, and nothing else.
  const ask = async (said) => {
    const answerIt = (result) => run.frame?.contentWindow?.postMessage({ type: 'changed', asked: said.asked, ...result }, '*');
    const ops = Array.isArray(said.ops) ? said.ops.slice(0, mostOps) : [];
    if (!run.coder) return answerIt({ error: 'This drawing is not kept on the map, so it may not change it.' });
    if (!may('write')) return answerIt({ error: 'This session may only read the map.' });
    if (!ops.length) return answerIt({ error: 'A change needs ops.' });
    try {
      const made = await api('change', { ops, reason: String(said.reason || 'Asked for by a drawing').slice(0, 300), drawing: run.coder });
      answerIt({ status: made.status, created: made.created ?? {}, ...(made.proposal && { proposal: made.proposal, held: made.held_by?.say ?? '' }) });
      // What it made is not yet in the answer the page keeps (that follows only what it holds): the lens is read again.
      if (Object.keys(made.created ?? {}).length) host.dispatchEvent(new CustomEvent('lens-read', { bubbles: true }));
    } catch (err) {
      answerIt({ error: String(err.message).slice(0, 300) });
    }
  };
  const hear = (run.hear = (ev) => {
    if (!host.isConnected) return void window.removeEventListener('message', hear);
    if (ev.source !== run.frame?.contentWindow) return;
    const said = ev.data ?? {};
    // The frame has no origin to name, so it is spoken to by its window alone; what goes in is only what it is to draw.
    if (said.type === 'ready') ((run.frame.ready = true), (error.hidden = true));
    if (said.type === 'ready') ((run.sent = true), run.frame.contentWindow.postMessage({ type: 'draw', ...drawing(), hot: run.hot }, '*'), (run.hot = undefined));
    // Its code has returned and its worker painted: the view has drawn (ui/look.js), and what was said before is past.
    else if (said.type === 'drew') ((error.hidden = true), saidDrawn(host, 'drawn'));
    // It may ask for an item's page and nothing else: an id is the only address taken from it.
    else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
    else if (said.type === 'change') ask(said);
    // Opened, what the old code kept, for the new frame (run.swap).
    else if (said.type === 'kept' && run.keeping) (clearTimeout(run.keeping), (run.keeping = undefined), (run.hot = said.state), draw());
    // Its code hears no new answer: drawn again from the start, handed what it kept.
    else if (said.type === 'stale') run.swap();
    // The first thing that went wrong is the one to read: what follows is usually its echo.
    else if (said.type === 'error' && error.hidden) shown(`This layout's code stopped: ${String(said.message).slice(0, 300)}`);
  });
  window.addEventListener('message', hear);
  // A bar only for the switch, when the view offers it.
  const lit = litSwitch(answer.viewer, style, (change) => (run.keep(change), Object.assign(run.style, change), (run.fields = JSON.stringify(run.style))), () => run.swap());
  host.replaceChildren(...[lit && h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit), error, stage].filter(Boolean));
  draw();
}

/**
 * A layout's code baked once (task e_p6xkk2fg): run in a frame walled in, whatever the workspace lets drawings do, its
 * code painting each of its looks on a canvas that keeps outlines (packs/walls/page/draw.js, bake). Resolves to its
 * outlines and each look's colours, or rejects with why; the frame is put away either way.
 */
export function bakeCode({ code, answer, style, theme, width, height }) {
  return new Promise((resolve, reject) => {
    const frame = h('iframe', { class: 'bake-frame', sandbox: frameSandbox(), src: '/draw.html', title: 'A drawing being baked', hidden: true });
    const done = (fn, value) => (removeEventListener('message', hear), clearTimeout(late), frame.remove(), fn(value));
    const hear = (ev) => {
      if (ev.source !== frame.contentWindow) return;
      const said = ev.data ?? {};
      if (said.type === 'ready') frame.contentWindow.postMessage({ type: 'bake', code, answer, style, theme, width, height }, '*');
      else if (said.type === 'baked') done(resolve, said.baking);
      else if (said.type === 'error') done(reject, new Error(String(said.message).slice(0, 300)));
    };
    // A bake that says nothing for two minutes has stopped.
    const late = setTimeout(() => done(reject, new Error('The drawing did not finish baking')), 120000);
    addEventListener('message', hear);
    document.body.append(frame);
  });
}

/**
 * Where a page's words stand, in the page's own coordinates: its hero (the section it opens on), what stands above it
 * (its nav, a title), its name where it shows one, and its column (everything else in its main, and its foot), as one
 * box. A page's frame is baked around them (pageAt). A backdrop is told each block on its own instead (`blocks`: the
 * nav, the title, each paragraph, list and figure, the foot) and the page's call to action (`focus`, the link of its
 * first p.action), so its land may come between them (packs/walls/page/backdrop.js).
 */
export function pageWords(doc, win) {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + win.scrollY, w: r.width, h: r.height }; };
  const shows = (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.width > 0; };
  // The section it opens on, of those shown (a backdrop's own is taken away).
  const seen = (el) => (el && el.getBoundingClientRect().height > 0 ? el : null);
  const lead = seen(doc.querySelector('main section.lead')) ?? [...doc.querySelectorAll('main section')].find(seen) ?? null;
  // What stands above the hero (the site's nav, a title) is kept clear where it is; the rest below it is the column.
  const heroFoot = lead ? box(lead).y + box(lead).h : 0;
  const shown = [...doc.querySelectorAll('nav.site-head'), ...doc.querySelectorAll('main > *'), ...doc.querySelectorAll('footer')].filter((el) => el !== lead && !lead?.contains(el) && !el.contains(lead) && el.getBoundingClientRect().height > 0).map(box);
  const above = shown.filter((b) => b.y + b.h <= heroFoot - (lead ? box(lead).h : 0) + 4), parts = shown.filter((b) => b.y >= heroFoot - 4);
  const x0 = Math.min(...parts.map((b) => b.x)), x1 = Math.max(...parts.map((b) => b.x + b.w)), y0 = Math.min(...parts.map((b) => b.y)), y1 = Math.max(...parts.map((b) => b.y + b.h));
  // The page's name, where it shows it (its title over the hero, or a heading in it): kept clear, and the drawing draws no name of its own.
  const namedEls = [...doc.querySelectorAll('main h1, main section.lead h2, main .wordmark')].filter((el) => el.getBoundingClientRect().height > 0);
  const named = namedEls.map(box);
  // Each block apart: what holds blocks (words, a band, a section) is opened, and a call to action is its link alone.
  const into = (el) => (!shows(el) ? [] : el.matches('div.text, div.doc-band, div.band-pictures, section') ? [...el.children].flatMap(into) : el.matches('p.action') ? [el.querySelector('a') ?? el].filter(shows) : [el]);
  const tops = new Set([...doc.querySelectorAll('nav.site-head'), ...doc.querySelectorAll('main > *'), ...doc.querySelectorAll('footer')]);
  const blockEls = [...tops].filter((el) => el !== lead && !lead?.contains(el) && !el.contains(lead)).flatMap(into);
  const blocks = [...blockEls, ...namedEls.filter((el) => !blockEls.some((b) => b.contains(el)))].map(box);
  const action = [...doc.querySelectorAll('main p.action a')].find(shows);
  return { hero: lead && box(lead), above, named, column: parts.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null, blocks, focus: action ? box(action) : null };
}

/**
 * How a page lays out at a width, read from its preview in a frame of that width out of sight: its hero (the section it
 * opens on), its nav, and its column (everything else in its main and its foot). The frame is put away after.
 */
function pageAt(id, width) {
  return new Promise((resolve, reject) => {
    const frame = h('iframe', { class: 'bake-frame', src: `/preview/${id}`, title: 'The page laid out to be baked' });
    // Out of sight, at the width it is baked for (the page's policy allows no style attribute: set as properties).
    Object.assign(frame.style, { position: 'fixed', left: `${-2 * width}px`, top: '0', width: `${width}px`, height: `${width}px`, border: '0', visibility: 'hidden' });
    const late = setTimeout(() => (frame.remove(), reject(new Error('The page did not lay out to be baked'))), 60000);
    frame.addEventListener('load', async () => {
      try {
        const doc = frame.contentDocument, win = frame.contentWindow;
        // The page draws itself after it loads: wait for its main, its fonts and a moment for its words to settle.
        for (let n = 0; n < 100 && !doc.querySelector('main section'); n++) await new Promise((r) => setTimeout(r, 100));
        await doc.fonts?.ready;
        await new Promise((r) => setTimeout(r, 800));
        resolve(pageWords(doc, win));
      } catch (err) {
        reject(err);
      } finally {
        clearTimeout(late);
        frame.remove();
      }
    }, { once: true });
    document.body.append(frame);
  });
}

/**
 * A page's frame at one width (the view's numbers.page_frame): the land baked at the page's width around its hero's
 * name, its nav and its column, running to the frame (numbers.frame_inset). Channels of water cross it every
 * numbers.frame_period from the hero's foot, so a page of any height shows its top, as many periods of margin as fit,
 * and its foot band (numbers.frame_foot high), each cut on water.
 */
function frameAt(layout, width, numbers = {}) {
  const narrow = width < 600, n = (k, v) => (Number(numbers[k]) > 0 ? Number(numbers[k]) : v);
  const pad = narrow ? 12 : 44, period = n('frame_period', narrow ? 220 : 280), band = n('frame_foot', narrow ? 300 : 420);
  const top = Math.round(layout.hero ? layout.hero.y + layout.hero.h : 0) || period;
  const bottom = layout.column ? layout.column.y + layout.column.h + pad : top + period;
  const foot = top + Math.max(1, Math.ceil((bottom - top) / period)) * period;
  const grow = (b, by) => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by });
  const channels = [];
  for (let y = top; y <= foot; y += period) channels.push({ x: 0, y: y - 13, w: width, h: 26 });
  // The column is kept clear down to the foot, so what repeats between the top and the foot is the margins alone.
  const column = layout.column && grow(layout.column, pad);
  const kept = column ? [{ ...column, h: Math.max(column.h, foot - column.y) }] : [];
  const clear = [...kept, ...(layout.above ?? []).map((b) => grow(b, 12)), ...(layout.named ?? []).map((b) => grow(b, narrow ? 16 : 32)), ...channels];
  const nameAt = layout.hero ? layout.hero.y + layout.hero.h / 2 : top / 2;
  return { top, period, foot, height: foot + band, page: { width, height: foot + band, clear, nameAt, ...(layout.named?.length && { name: false }), inset: n('frame_inset', 0), edges: 0, every: n('frame_every', 5) } };
}

/** The widths a page's frame is baked at: a phone's, a tablet's and a wide screen's, each shown cut to the window's width. */
const FRAME_WIDTHS = [420, 960, 1680];

/**
 * Each layout kept on the map in a document, baked as publishing it would freeze it (its preview), in the dark and in
 * the light: by its view, the hash of the code it ran and what it painted, for publish to keep as its SVG. A view
 * marked as the page's frame (numbers.page_frame) is baked at each width around the page's words.
 */
export async function bakeDocument(id, preview) {
  const data = await preview(id);
  const baked = {};
  for (const [lens, frozen] of Object.entries(data?.lenses ?? {})) {
    const { style: { drawing, ...style } = {}, ...answer } = frozen;
    if (!drawing?.coded || !drawing.modules) continue;
    // A view that only runs behind the page (numbers.page_backdrop) is not baked: a page's frame, another view, is its first paint.
    if (Number(style.numbers?.page_backdrop) > 0 && !(Number(style.numbers?.page_frame) > 0)) continue;
    const at = (dark, width, height, page) => bakeCode({ code: drawing.modules, answer, style: { ...style, still: true, ...(page && { page }) }, theme: { dark }, width, height });
    if (Number(style.numbers?.page_frame) > 0) {
      const page = [];
      for (const width of FRAME_WIDTHS) {
        const f = frameAt(await pageAt(id, width), width, style.numbers);
        page.push({ width, top: f.top, period: f.period, foot: f.foot, baking: await at(true, width, f.height, f.page), light: await at(false, width, f.height, f.page) });
      }
      baked[lens] = { hash: drawing.hash, page };
      continue;
    }
    // Its own units: as wide as a frame on a wide page, as high as the shape its view says.
    const width = 1200, aspect = Number(style.numbers?.frame_aspect);
    const height = Math.round(aspect > 0 ? width / aspect : (width * 9) / 16);
    baked[lens] = { hash: drawing.hash, baking: await at(true, width, height), light: await at(false, width, height) };
  }
  return baked;
}

/**
 * What was baked, made small to send: its JSON gzipped, as base64 (publish unpacks it, packs/publish/kernel/published-baked.ts).
 * A page's frame at three widths is tens of megabytes of outlines as JSON, and a few as gzip.
 */
export async function packBaked(baked) {
  const zipped = await new Response(new Blob([JSON.stringify(baked)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const url = await new Promise((resolve, reject) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result), onerror: reject }).readAsDataURL(zipped));
  return String(url).slice(String(url).indexOf(',') + 1);
}

/**
 * Before a document is published or shared: each layout kept on the map in it baked (bakeDocument), made small
 * (packBaked) and handed to the server beside the preview it was baked from, for the publish or share that follows to
 * take. What could not be baked is said, and the page goes out with its drawings running, as before.
 */
export async function bakeBeforeGoingOut(id) {
  // Only a document has a preview to bake from: anything else (a view shared on its own) goes out as it is, nothing said.
  const data = await call(`/preview/${id}/data`, {}, authHeaders()).catch(() => null);
  if (!data) return;
  const baked = await bakeDocument(id, async () => data).catch((err) => (tell('Its drawings were not baked', `They run live on its page: ${err.message}`), null));
  if (!baked || !Object.keys(baked).length) return;
  await call(`/preview/${id}/data`, { baked: await packBaked(baked) }, authHeaders()).catch((err) => tell('Its drawings were not kept', `They run live on its page: ${err.message}`));
}
