// Tries of code the person looking sent (map-code watch --preview, packs/surface/kernel/tool-preview.ts): the page waits for
// them, and a view drawn by the layout a try is of draws with the try in its place, its edge dashed as a held change's
// ghost is. Above find, one line for each try: what it is of, Save (one change, as the person) and Discard. Nobody
// else's page hears of it.

import { api, h, loadMay, may } from './base.js';

/** The tries now, by `${item} ${field}`. */
const held = new Map();
// A look of code not yet saved (query look with tries, packs/look_draw/kernel/look-draw.ts): the server's Chrome sets its tries before any code runs, so the first drawing is already the try.
for (const p of globalThis.lookTries ?? []) held.set(`${p.item} ${p.field}`, p);
/** Where the tries last stood, as the server stamps them. */
let at;

/** Each view that draws: told when the tries move, so one a try is of draws again. */
const MOVED = 'previews-moved';

/** The try a style is drawn with, if one is of what draws it: a layout's code (coder, the layout whose code draws), or a pack drawing's version. */
export function triedOn(style, coder) {
  const code = coder && held.get(`${coder} code`);
  if (code && (typeof style.code === 'string' || (style.code && typeof style.code === 'object'))) return code;
  const id = style.drawing?.id;
  return id && !((typeof style.code === 'string' && style.code.trim()) || (style.code && typeof style.code === 'object')) ? [...held.values()].find((p) => p.drawing?.id === id) : undefined;
}

/** Put the try a style is drawn with in its place, in the style itself; answers the try. */
export function tryOn(style, coder) {
  const preview = triedOn(style, coder);
  if (preview?.drawing) style.drawing = preview.drawing;
  else if (preview) style.code = preview.value;
  return preview;
}

/** Mark a view drawn with a try (its edge dashed, style.css), or unmark it. */
export const markTry = (host, preview) => host.toggleAttribute('data-preview', Boolean(preview));

/** Keep a try as one change, as the person looking, then drop it; or only drop it. */
async function settle(preview, keep, buttons) {
  for (const b of buttons) b.disabled = true;
  try {
    if (keep) await api('change', { ops: [{ op: 'update', id: preview.item, props: { [preview.field]: preview.value } }], reason: `Kept the try of ${preview.field} on ${preview.title}` });
    await api('preview', { item: preview.item, field: preview.field, discard: true });
  } catch (err) {
    for (const b of buttons) ((b.disabled = false), (b.title = String(err.message).slice(0, 300)));
  }
}

/** The line above find for one try. */
function line(preview) {
  const save = h('button', { type: 'button', class: 'primary', title: `Keep this ${preview.field} on ${preview.title}: one change, as you` }, 'Save');
  const drop = h('button', { type: 'button', class: 'quiet-button', title: 'Draw with what the map holds again' }, 'Discard');
  save.onclick = () => settle(preview, true, [save, drop]);
  drop.onclick = () => settle(preview, false, [save, drop]);
  const sent = new Date(preview.at).toLocaleTimeString();
  return h('div', { class: 'try-call' }, h('span', { class: 'try-call-n' }, '◌ Try'), h('span', { class: 'grow cut', title: `${preview.field} of ${preview.title}, sent ${sent}: only you see it` }, preview.title), save, drop);
}

const calls = h('div', { class: 'try-calls' });
document.getElementById('find')?.prepend(calls);

/** Take what the server answered, and tell the views when it moved. */
function heard(answer) {
  if (!answer || answer.at === at) return;
  at = answer.at;
  const now = new Map((answer.previews ?? []).map((p) => [`${p.item} ${p.field}`, p]));
  const same = now.size === held.size && [...now].every(([key, p]) => held.get(key)?.at === p.at);
  if (same) return;
  held.clear();
  for (const [key, p] of now) held.set(key, p);
  calls.replaceChildren(...[...held.values()].map(line));
  window.dispatchEvent(new CustomEvent(MOVED));
}

/** A view hears the tries move: `redraw` draws it again. Stops when `host` leaves the page. */
export function onTries(host, redraw) {
  const hear = () => (host.isConnected ? redraw() : window.removeEventListener(MOVED, hear));
  window.addEventListener(MOVED, hear);
}

/** Wait for tries for as long as the page is open, one call at a time; a person who only reads sends none. */
async function follow() {
  if (!(await loadMay().then(() => may('write'), () => false))) return;
  for (;;) {
    try {
      heard((await api('tail', at === undefined ? { tries: 0 } : { tries: at, wait: 20 })).tries);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
follow();
