// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by the app's own shapes, read by anyone with no login. Nothing is asked of the map: the answer is all there
// is. A part opens nowhere; clicked, it says its first line under the picture.

import { h } from './base.js';
import { drawArch } from './arch.js';
import { drawFlow } from './flow.js';
import { dress } from './lens-base.js';
import { types } from './words.js';

/** The shapes a published picture is drawn in; any other is drawn as a flow. */
const SHAPES = { flow: drawFlow, architecture: drawArch };

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. */
export function drawFrozen(host, answer, typeTitles = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  const style = { ...answer.style, noLit: true };
  const body = h('div', { class: 'lens-view' });
  const said = h('p', { class: 'lens-said muted', hidden: true });
  // What a clicked part says is over the picture, where the eye already is.
  host.replaceChildren(said, body);
  dress(body, style);
  (SHAPES[style.shape] ?? drawFlow)(body, answer, style, () => {});
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  // A part is a way to its page in the app; here it says what it is instead.
  body.addEventListener('click', (ev) => {
    const link = ev.target.closest?.('a');
    const id = /^#\/e\/(e_[a-z0-9]{8})$/.exec(link?.getAttribute('href') ?? '')?.[1];
    if (!link) return;
    ev.preventDefault();
    const item = byId.get(id);
    if (!item) return void (said.hidden = true);
    said.replaceChildren(h('strong', {}, item.title), item.gist ? ` ${item.gist}` : '');
    said.title = [item.title, item.gist].filter(Boolean).join(' — ');
    said.hidden = false;
  });
}
