// What a part answers with, checked by its shape before anything is drawn. A part is a pack's code, run walled in a
// worker (decision e_xeqhcums), so nothing it sends is trusted: it says what is on its screen in a small vocabulary of
// marks, and the host alone makes them into the page (packs/walls/page/part-render.js), under the workspace's style.
//
// A mark is [kind, attributes, ...what is in it], as a drawing's is (packs/walls/page/marks.js); the attributes may be left out
// (['text', 'Hello']). Ten kinds, nothing richer:
//   box     a group of marks, in a row or a column
//   text    words
//   list    marks one under another, a row each
//   input   a field the person types in; its edits go back to the part
//   button  words the person presses; the press goes back to the part
//   paint   a surface in its own units that pans and zooms in the host, holding paths and placed text
//   path    a line or a shape on a paint surface
//   note    words in the map's note dialect, drawn as the item page draws a note (packs/walls/page/body.js)
//   menu    buttons behind a few words, for what is done rarely, placed in sight by the host
//   thumb   a kept view drawn small, as the host keeps it (its thumbnail): the part names the view, never draws it
// Any mark on the page may carry a `tip`: what it says of itself, shown by the page's one tooltip, and a `view`: pressed,
// the host opens that view (a kept view's id, a pack's view by its own, or home), as an `item` opens an item's page.
// Every look is a name the style gives its value (packs/walls/page/part-marks.css): a tone, a gap or a size is a word or a step on
// the style's scale, never a colour or a length. This module reads no page: it is run without a browser in tests.

/** How much one part may say at once: past it, what it sent is refused whole. */
export const partLimits = { marks: 5000, depth: 32, words: 20000, path: 100000, key: 80, label: 200, side: 1000000 };

const KEY = /^[A-Za-z0-9_:.-]+$/;
const ITEM = /^e_[a-z0-9]{8}$/;
/** A view: one kept on the map (its id), one a pack ships (its id, `<pack>.<name>`), or home. */
const VIEW = /^(?:e_[a-z0-9]{8}|home|[a-z][a-z0-9_]*(?:.[a-z][a-z0-9_-]*)+)$/;
/** A path says only where it goes: its commands and numbers, nothing that could name or fetch anything. */
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

const oneOf = (...words) => (v, why) => (words.includes(v) ? v : why(`"${String(v).slice(0, 40)}", not one of ${words.join(', ')}`));
const step = (least, most) => (v, why) => (Number.isInteger(v) && v >= least && v <= most ? v : why(`${String(v).slice(0, 40)}, not a whole step from ${least} to ${most}`));
const flag = (v, why) => (typeof v === 'boolean' ? v : why('not true or false'));
const words = (most) => (v, why) => (typeof v === 'string' || typeof v === 'number' ? (String(v).length <= most ? String(v) : why(`more than ${most} characters`)) : why('not words'));
const number = (v, why) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= partLimits.side ? v : why('not a number the page can place'));
const side = (v, why) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= partLimits.side ? v : why('not a size above nothing'));
const point = (v, why) => (Array.isArray(v) && v.length === 2 ? v.map((n) => number(n, why)) : why('not [x, y]'));
const key = (v, why) => (typeof v === 'string' && v.length <= partLimits.key && KEY.test(v) ? v : why('a key of letters, digits and _ : . - only'));
const view = (v, why) => (typeof v === 'string' && v.length <= partLimits.key && VIEW.test(v) ? v : why("not a view's id"));
const item = (v, why) => (typeof v === 'string' && ITEM.test(v) ? v : why("not an item's id"));
const path = (v, why) => (typeof v !== 'string' ? why('not a path') : v.length > partLimits.path ? why(`a path over ${partLimits.path} characters`) : PATH.test(v) ? v : why('a path with what is not a path command or a number'));

/** The tones a mark may take: each a colour the style names. */
export const TONES = ['accent', 'muted', 'ok', 'warn', 'bad', 'closed'];
const tone = oneOf(...TONES);
/** What any mark may say: its key, the item or view it stands for and, on the page, its tip. */
const anyMark = { key, item, view, tip: words(partLimits.label) };

/**
 * Each kind: the attributes it may have and how each is read, what it may hold (`marks`, `words`, `drawn`: paths and
 * placed text, or nothing), whether it needs a key (what the person does to it goes back by it), and whether it lies
 * on a paint surface (`plane`) or on the page.
 */
export const MARKS = {
  box: { attrs: { ...anyMark, look: oneOf('plain', 'band', 'sunk'), tone, flow: oneOf('row', 'column'), gap: step(0, 14), pad: step(0, 14), grow: flag, align: oneOf('start', 'center', 'end', 'between'), wrap: flag }, holds: 'marks' },
  text: { attrs: { ...anyMark, look: oneOf('body', 'title', 'muted', 'mark', 'code'), tone, size: step(1, 9), bold: flag, x: number, y: number, anchor: oneOf('start', 'middle', 'end') }, holds: 'words' },
  list: { attrs: { ...anyMark, look: oneOf('plain', 'rows'), gap: step(0, 14) }, holds: 'marks' },
  input: { attrs: { key, tip: anyMark.tip, value: words(partLimits.words), hint: words(partLimits.label), label: words(partLimits.label), lines: step(1, 20), grow: flag }, holds: 'nothing', keyed: true },
  button: { attrs: { ...anyMark, look: oneOf('main', 'quiet'), tone, label: words(partLimits.label) }, holds: 'words', keyed: true },
  paint: { attrs: { key, tip: anyMark.tip, width: side, height: side, start: point, pixels: flag }, holds: 'drawn' },
  path: { attrs: { key, item, d: path, look: oneOf('line', 'fill', 'dash'), tone, weight: step(1, 4) }, holds: 'nothing', plane: true, needs: ['d'] },
  note: { attrs: { ...anyMark, tick: flag }, holds: 'words' },
  menu: { attrs: { ...anyMark, label: words(partLimits.label), look: oneOf('main', 'quiet') }, holds: 'marks', only: ['button'], needs: ['label'] },
  thumb: { attrs: { key, view, tip: anyMark.tip }, holds: 'nothing', needs: ['view'] },
};

/** The nodes this module made: the renderer draws nothing else. */
const checked = new WeakSet();
/** Whether `node` is what checkMarks answered with, not something shaped like it. */
export const isChecked = (node) => checked.has(node);

/** A mark's name with its article: a box, an input. */
const a = (k) => (/^[aeiou]/.test(k) ? `an ${k}` : `a ${k}`);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/**
 * Check what a part answered with, whole, and answer with the nodes to draw: { kind, key?, item?, at: { attribute:
 * value }, kids: [node] } or, for a kind that holds words, { ..., words }. Anything else is refused with an Error that
 * says what and where (`box 0 > text 2`), and nothing of it is drawn. `kinds`, the marks the part's manifest names
 * (packs/loader/kernel/ui-parts.ts), holds it to them: a mark it did not name is refused too.
 */
export function checkMarks(mark, { kinds } = {}) {
  const seen = { n: 0, words: 0, keys: new Set(), kinds };
  return node(mark, seen, [], false);
}

function node(mark, seen, where, onPlane) {
  const why = (what) => {
    throw new Error(`The part sent what cannot be drawn: ${what}${where.length ? ` (at ${where.join(' > ')})` : ''}`);
  };
  if (!Array.isArray(mark) || typeof mark[0] !== 'string') why('a mark that is not [kind, attributes, ...]');
  if (++seen.n > partLimits.marks) why(`more than ${partLimits.marks} marks`);
  if (where.length >= partLimits.depth) why(`marks deeper than ${partLimits.depth}`);
  const [kind] = mark;
  const shape = Object.hasOwn(MARKS, kind) ? MARKS[kind] : why(`the mark "${kind.slice(0, 40)}"`);
  if (seen.kinds && !seen.kinds.includes(kind)) why(`the mark "${kind}", which the part does not name in its marks`);
  const given = plain(mark[1]) ? mark[1] : undefined;
  const rest = mark.slice(given ? 2 : 1);
  if (!given && mark.length > 1 && typeof mark[1] === 'object' && !Array.isArray(mark[1])) why(`${kind}'s attributes, not a plain object`);
  // What lies on a paint surface is placed in its units; what lies on the page is laid out by it.
  if (shape.plane && !onPlane) why(`${a(kind)} off a paint surface`);
  if (kind === 'paint' && onPlane) why('a paint surface on a paint surface');
  if (onPlane && !shape.plane && kind !== 'text') why(`${a(kind)} on a paint surface: it holds paths and text`);
  const at = {};
  for (const [name, value] of Object.entries(given ?? {})) {
    const read = Object.hasOwn(shape.attrs, name) ? shape.attrs[name] : why(`the attribute "${name.slice(0, 40)}" on ${a(kind)}`);
    at[name] = read(value, (what) => why(`${kind}'s ${name}: ${what}`));
  }
  const placed = at.x !== undefined || at.y !== undefined || at.anchor !== undefined;
  if (kind === 'text' && onPlane && (at.x === undefined || at.y === undefined)) why('text on a paint surface with no x and y');
  if (onPlane && at.tip !== undefined) why(`a tip on ${a(kind)} on a paint surface: what lies there keeps none`);
  if (kind === 'note' && at.tick && at.key === undefined) why('a note that ticks with no key: a tick goes back by its key');
  if (kind === 'text' && !onPlane && placed) why('x, y or anchor on text off a paint surface');
  for (const name of shape.needs ?? []) if (at[name] === undefined) why(`${a(kind)} with no ${name}`);
  if (kind === 'paint' && (at.width === undefined || at.height === undefined)) why('a paint surface with no width and height');
  if (shape.keyed && at.key === undefined) why(`${a(kind)} with no key: what the person does to it goes back by its key`);
  if (at.key !== undefined) seen.keys.has(at.key) ? why(`the key "${at.key}" twice`) : seen.keys.add(at.key);
  const out = { mark: kind, at, ...(at.key !== undefined && { key: at.key }), ...(at.item !== undefined && { item: at.item }), ...(at.view !== undefined && kind !== 'thumb' && { view: at.view }) };
  if (shape.holds === 'nothing' && rest.length) why(`${a(kind)} holding something: it holds nothing`);
  if (shape.holds === 'words') {
    const said = rest.map((w) => (typeof w === 'string' || typeof w === 'number' ? String(w) : why(`${a(kind)} holding a mark: it holds words`))).join('');
    if ((seen.words += said.length) > partLimits.words) why(`more than ${partLimits.words} characters of words`);
    out.words = said;
  } else {
    const inner = shape.holds === 'drawn';
    out.kids = rest.map((kid, i) => (typeof kid === 'string' || typeof kid === 'number' ? why(`words in ${a(kind)}: put them in a text`) : node(kid, seen, [...where, `${kind} ${i}`], inner || onPlane)));
    for (const kid of shape.only ? out.kids : []) if (!shape.only.includes(kid.mark)) why(`${a(kid.mark)} in ${a(kind)}: it holds ${shape.only.join(' and ')}s only`);
  }
  checked.add(out);
  return out;
}
