// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by its drawing or by the app's own shapes, read by anyone with no login. Nothing is asked of the map: the
// answer is all there is. A part opens nowhere; hovered (or tapped), it says what it is in a tip beside it.

import { h } from './base.js';
import { drawWith } from './drawing.js';
import { dress } from './lens-base.js';
import { types } from './words.js';

/** The shapes a published picture is drawn in, each loaded when one is drawn; any other is drawn as a flow. */
const SHAPES = { flow: () => import('./flow.js').then((m) => m.drawFlow), grid: () => import('./grid.js').then((m) => m.drawGrid), time: () => import('./timeline.js').then((m) => m.drawTime) };
const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. */
export function drawFrozen(host, answer, typeTitles = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  const tip = h('div', { class: 'lens-tip', role: 'tooltip', hidden: true });
  host.replaceChildren(body, tip);
  dress(body, style);
  // A picture on a time axis is drawn along it, as in the app.
  if (style.drawing) drawWith(body, answer, style, () => {});
  else (SHAPES[answer.lens.time && !SHAPES[style.shape] ? 'time' : style.shape] ?? SHAPES.flow)().then((draw) => draw(body, answer, style, () => {}));
  const byId = new Map(answer.items.map((item) => [item.id, item]));

  // What a part is, in a tip beside it: its name as the picture shows it now, and its first line. The part's own
  // title (which the browser would show again, slowly) is set aside while the tip is up, and put back after.
  let at = null;
  const hide = () => {
    if (at?.title) at.link.prepend(at.title);
    at = null;
    tip.hidden = true;
  };
  const show = (link) => {
    if (at?.link === link) return;
    hide();
    const item = byId.get(ITEM.exec(link.getAttribute('href') ?? '')?.[1]);
    if (!item) return;
    const title = [...link.children].find((el) => el.tagName.toLowerCase() === 'title');
    const name = title?.textContent.split('\n')[0] || item.title;
    title?.remove();
    at = { link, title };
    tip.replaceChildren(h('strong', {}, name), item.gist && h('span', {}, item.gist));
    tip.hidden = false;
    // Above the part, centred on it and kept inside the picture; below it where there is no room above.
    const part = link.getBoundingClientRect(), frame = host.getBoundingClientRect();
    const half = tip.offsetWidth / 2, middle = part.left + part.width / 2 - frame.left;
    const below = part.top - frame.top < tip.offsetHeight;
    tip.classList.toggle('below', below);
    tip.style.left = `${Math.min(Math.max(middle, half), host.clientWidth - half)}px`;
    tip.style.top = `${(below ? part.bottom : part.top) - frame.top}px`;
  };
  const partOf = (target) => {
    const link = target.closest?.('a[href]');
    return link && body.contains(link) && ITEM.test(link.getAttribute('href') ?? '') ? link : null;
  };
  body.addEventListener('mouseover', (ev) => {
    const link = partOf(ev.target);
    if (link) show(link);
  });
  body.addEventListener('mouseout', (ev) => {
    if (at && !at.link.contains(ev.relatedTarget)) hide();
  });
  // A part is a way to its page in the app; here a tap shows its tip, for a screen with no pointer to hover.
  body.addEventListener('click', (ev) => {
    const link = ev.target.closest?.('a');
    if (!link) return hide();
    ev.preventDefault();
    const part = partOf(ev.target);
    if (part) show(part);
  });
  // A shape that opens an item by the address (a bar in time) has the address put back.
  addEventListener('hashchange', () => {
    if (ITEM.test(location.hash) && byId.has(ITEM.exec(location.hash)[1])) history.replaceState(null, '', location.pathname);
  });
}
