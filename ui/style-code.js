// A style that carries its own code: the drawing a person or an agent wrote for their own project.

import { api, frameSandbox, h } from './base.js';
import { STYLE_COLORS, litSwitch } from './lens-base.js';
import { saidDrawn } from './look.js';

/** The most ops one ask of a drawing may carry. */
const mostOps = 50;

/**
 * A style that carries its own code is the drawing: the page runs it in a
 * frame that is sandboxed (an origin of its own, nothing loaded from outside,
 * nothing sent anywhere), hands it the lens answer, the style's fields and the
 * page's colours, and listens for three things: open this item, change the map
 * (sent here as the person, naming the style whose code asked, `coder`, for the
 * rules to judge: src/drawing-changes.ts), and what went wrong. A new frame for
 * each picture, so nothing of the last is left running; a new answer for the same
 * code and fields goes to the frame already running, when its code listens for one.
 */
export function drawCode(host, answer, style, keep, _place, coder) {
  const { code, ...fields } = style;
  const { style: _kept, ...data } = answer;
  const same = host.coded && host.coded.code === code && JSON.stringify(fields) === host.coded.fields && host.coded.frame?.isConnected && host.coded.frame.ready;
  if (same) return void (host.coded.data = data, host.coded.frame.contentWindow.postMessage({ type: 'answer', answer: data }, '*'));
  const error = h('div', { class: 'lens-error', hidden: true });
  const stage = h('div', { class: 'code-stage' });
  const colours = () => Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(host).getPropertyValue(`--ln-${name}`).trim()]));
  if (host.coded) window.removeEventListener('message', host.coded.hear);
  const run = (host.coded = { code, fields: JSON.stringify(fields), data, frame: undefined, hear: undefined });
  const draw = () => {
    error.hidden = true;
    run.frame = h('iframe', { class: 'lens-frame', sandbox: frameSandbox(), src: '/draw.html', title: 'The map, drawn by this style' });
    stage.replaceChildren(run.frame);
    // A frame that never says it is ready was not let in by the browser: say so, not a blank.
    const mine = run.frame;
    setTimeout(() => mine === run.frame && !mine.ready && host.isConnected && ((error.textContent = 'This style has code of its own, and the browser did not start the frame it runs in.'), (error.hidden = false), saidDrawn(host, 'error', error.textContent)), 5000);
  };
  // What the drawing asked for, sent as the person looking; what came of it goes back to the drawing, and nothing else.
  const ask = async (said) => {
    const answerIt = (result) => run.frame?.contentWindow?.postMessage({ type: 'changed', asked: said.asked, ...result }, '*');
    const ops = Array.isArray(said.ops) ? said.ops.slice(0, mostOps) : [];
    if (!coder) return answerIt({ error: 'This drawing is not kept on the map, so it may not change it.' });
    if (!ops.length) return answerIt({ error: 'A change needs ops.' });
    try {
      const made = await api('change', { ops, reason: String(said.reason || 'Asked for by a drawing').slice(0, 300), drawing: coder });
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
    if (said.type === 'ready') run.frame.ready = true;
    if (said.type === 'ready') run.frame.contentWindow.postMessage({ type: 'draw', code, answer: run.data, style: fields, theme: { ...colours(), dark: matchMedia('(prefers-color-scheme: dark)').matches } }, '*');
    // Its code has returned and its worker painted: the view has drawn (ui/look.js).
    else if (said.type === 'drew') saidDrawn(host, 'drawn');
    // It may ask for an item's page and nothing else: an id is the only address taken from it.
    else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
    else if (said.type === 'change') ask(said);
    // Its code hears no new answer: drawn again from the start.
    else if (said.type === 'stale') draw();
    // The first thing that went wrong is the one to read: what follows is usually its echo.
    else if (said.type === 'error' && error.hidden) ((error.textContent =`This style's code stopped: ${String(said.message).slice(0, 300)}`), (error.title = error.textContent), (error.hidden = false), saidDrawn(host, 'error', error.textContent));
  });
  window.addEventListener('message', hear);
  // A bar only for the switch, when the view offers it.
  const lit = litSwitch(answer.viewer, style, (change) => (keep(change), Object.assign(fields, change)), draw);
  host.replaceChildren(...[lit && h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit), error, stage].filter(Boolean));
  draw();
}
