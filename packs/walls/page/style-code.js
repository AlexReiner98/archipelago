// A layout's code: the drawing a person or an agent wrote for their own project.
//
// Runtime, not a part (rule e_6d2g62tg, task e_u2phc9rq): the page side of a layout's wall, it mounts the walled frame
// a layout's code runs in and hears it, which a worker never can. It says what came of a drawing as look mode hears
// it (a view-drawn event, as ui/look.js says it), so it imports nothing of the app.

import { api, drawingsOpen, frameSandbox, h, may } from './base.js';
import { STYLE_COLORS, litSwitch } from './query-base.js';

/** Say on `el` how its drawing went, as look mode listens for it (ui/look.js, saidDrawn). */
const saidDrawn = (el, state, why) => el.dispatchEvent(new CustomEvent('view-drawn', { bubbles: true, detail: { state, why } }));

/** The frame's address (named with the UI's version as it is served), asked for opened. */
const opened = (frame) => ((frame = new URL(frame, location.href)), frame.searchParams.set('open', '1'), frame.pathname + frame.search);

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
  if (warm && was.code === code && JSON.stringify(fields) === was.fields) return void ((was.data = data), was.frame.contentWindow.postMessage({ type: 'answer', answer: data }, '*'));
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
