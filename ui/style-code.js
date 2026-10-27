// A style that carries its own code: the drawing a person or an agent wrote for their own project.

import { h } from './base.js';
import { STYLE_COLORS, litSwitch } from './lens-base.js';
import { saidDrawn } from './look.js';

/**
 * A style that carries its own code is the drawing: the page runs it in a
 * frame that is sandboxed (an origin of its own, nothing loaded from outside,
 * nothing sent anywhere), hands it the lens answer, the style's fields and the
 * page's colours, and listens for two things: open this item, and what went
 * wrong. A new frame for each picture, so nothing of the last is left running.
 */
export function drawCode(host, answer, style, keep) {
  const { code, ...fields } = style;
  const { style: _kept, ...data } = answer;
  const error = h('div', { class: 'lens-error', hidden: true });
  const stage = h('div', { class: 'code-stage' });
  const colours = () => Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(host).getPropertyValue(`--ln-${name}`).trim()]));
  let frame;
  const draw = () => {
    error.hidden = true;
    frame = h('iframe', { class: 'lens-frame', sandbox: 'allow-scripts', src: '/draw.html', title: 'The map, drawn by this style' });
    stage.replaceChildren(frame);
    // A frame that never says it is ready was not let in by the browser: say so, not a blank.
    const mine = frame;
    setTimeout(() => mine === frame && !mine.ready && host.isConnected && ((error.textContent = 'This style has code of its own, and the browser did not start the frame it runs in.'), (error.hidden = false), saidDrawn(host, 'error', error.textContent)), 5000);
  };
  const hear = (ev) => {
    if (!host.isConnected) return void (frame && window.removeEventListener('message', hear));
    if (ev.source !== frame?.contentWindow) return;
    const said = ev.data ?? {};
    // The frame has no origin to name, so it is spoken to by its window alone; what goes in is only what it is to draw.
    if (said.type === 'ready') frame.ready = true;
    if (said.type === 'ready') frame.contentWindow.postMessage({ type: 'draw', code, answer: data, style: fields, theme: { ...colours(), dark: matchMedia('(prefers-color-scheme: dark)').matches } }, '*');
    // Its code has returned and its worker painted: the view has drawn (ui/look.js).
    else if (said.type === 'drew') saidDrawn(host, 'drawn');
    // It may ask for an item's page and nothing else: an id is the only address taken from it.
    else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
    // The first thing that went wrong is the one to read: what follows is usually its echo.
    else if (said.type === 'error' && error.hidden) ((error.textContent =`This style's code stopped: ${String(said.message).slice(0, 300)}`), (error.title = error.textContent), (error.hidden = false), saidDrawn(host, 'error', error.textContent));
  };
  window.addEventListener('message', hear);
  // A bar only for the switch, when the view offers it.
  const lit = litSwitch(answer.viewer, style, (change) => (keep(change), Object.assign(fields, change)), draw);
  host.replaceChildren(...[lit && h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit), error, stage].filter(Boolean));
  draw();
}
