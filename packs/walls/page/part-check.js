// What a part answers with, checked by its shape before anything is drawn. A part is a pack's code, run walled in a
// worker (decision e_xeqhcums), so nothing it sends is trusted: it says what is on its screen in a small vocabulary of
// marks, and the host alone makes them into the page (packs/walls/page/part-render.js), under the workspace's style.
//
// A mark is [kind, attributes, ...what is in it], as a drawing's is (packs/walls/page/marks.js); the attributes may be left out
// (['text', 'Hello']). Ten kinds, nothing richer:
//   box     a group of marks, in a row or a column
//   text    words; with an href, an address on the web the host opens apart
//   list    marks one under another, a row each
//   input   a field the person types in or picks from (its kind: words, a number, an address, a day, a time, yes or
//           no, one of its values); its edits and picks go back to the part
//   button  words the person presses; the press goes back to the part, or (pick) the item then clicked on the canvas
//   paint   a surface in its own units that pans and zooms in the host, holding paths and placed text
//   path    a line or a shape on a paint surface
//   note    words in the map's note dialect, drawn as the item page draws a note (packs/walls/page/body.js)
//   menu    what is done rarely, behind a few words, placed in sight by the host: buttons, and the text, boxes, lists
//           and inputs that make steps of them (a head, a field that narrows what is under it, a way back)
//   thumb   a kept view drawn small, as the host keeps it (its thumbnail): the part names the view, never draws it
//   picture an item's picture, out of what the host handed the part (a view frozen as publishing keeps it, a figure):
//           the part names the item, the host draws it, so a part never sends an answer or an address
//   web     a page on the web framed in place, sandboxed and told nothing of where it is (its url)
//   pane    a canvas the host draws at an address (`at`), with the part's own marks in its strip; `at` of w?url= frames
//           a web page
//   panes   panes side by side (dir row) or one over another (column), each given room by its share; the host draws
//           the lines between them and tells the part when one is dragged
//   swatch  a style preset's colours, painted by the host from the preset the part names: a part paints no colour
//   ghost   nothing where it stands: a change held for the owner, as data the canvas reads back into its answer and draws
//           where it would land (of an item, a link, or a mark on one)
//   replay  nothing where it stands: the canvas under it shows what the person missed, up to step `at` of its steps
//   trace   nothing where it stands: its item's marks on the canvas painted with its line (`tip`), in a session's hue,
//           until the person has seen them; then the part is told `seen`
//   slot    the parts that fill a slot the part opens (`name`, one of its `opens`), drawn here by the host: the part
//           never sees them, nor they it (decision e_hp9xmrbq)
// Any mark may also carry `lights`: the items it stands for, lit on the canvas while the person points at it, the rest
// faded. A box may be `fits`: it shows as many of its marks as fit on one line and says how many are left (`more`: the
// key a press on the count goes back by). A box, a button or a pane may carry `drag`: the host follows it when it is
// pressed and moved, shows where it would land, and tells the part `drop`; a box or a button may be `selected`, `ring`
// once, take a session's `hue`, and (`aux`) go back as `close` when pressed with the middle button. A button may carry
// `copy` (its words go to the clipboard, said Copied) or `try` (a chosen style preset tried on this screen alone; null or
// '' the workspace's own again).
// Any mark on the page may carry a `tip`: what it says of itself, shown by the page's one tooltip, and a `view`: pressed,
// the host opens that view (a kept view's id, a pack's view by its own, or home), as an `item` opens an item's page.
// Every look is a name the style gives its value (packs/walls/page/part-marks.css): a tone, a gap or a size is a word or a step on
// the style's scale, never a colour or a length. This module reads no page: it is run without a browser in tests.

/** How much one part may say at once: past it, what it sent is refused whole. */
export const partLimits = { marks: 5000, depth: 32, words: 200000, path: 100000, key: 80, label: 200, side: 1000000 };

const KEY = /^[A-Za-z0-9_:.-]+$/;
const ITEM = /^e_[a-z0-9]{8}$/;
/** A view: one kept on the map (its id), one a pack ships (its id, `<pack>.<name>`), or home. */
/** A slot's name, as packs/loader/kernel/slots.ts names one. */
const SLOT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)*$/;
const slotName = (v, why) => (typeof v === 'string' && v.length <= partLimits.key && SLOT_NAME.test(v) ? v : why("not a slot's name"));
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
/** An address on the web a text opens apart: http or https, nothing that could run. */
const WEB = /^https?:\/\/[^\s"'<>\\]+$/i;
const href = (v, why) => (typeof v === 'string' && v.length <= 2000 && WEB.test(v) ? v : why('not an address on the web (http or https)'));
/** A list of words, each a value a pick offers or the name it is shown by. */
const wordList = (v, why) => (Array.isArray(v) && v.length <= 200 ? v.map((w) => words(partLimits.label)(w, why)) : why('not a list of at most 200 words'));
const path = (v, why) => (typeof v !== 'string' ? why('not a path') : v.length > partLimits.path ? why(`a path over ${partLimits.path} characters`) : PATH.test(v) ? v : why('a path with what is not a path command or a number'));

/**
 * What an input may be: words typed (text, number, url, search), a pick sent at once (date, time, check, pick), or an
 * item found by name (item): the host finds as the person types and tells the part only the one picked.
 */
export const INPUT_KINDS = ['text', 'number', 'url', 'search', 'date', 'time', 'check', 'pick', 'item'];
/** The kinds of input whose change is a pick, sent as one gesture, not words being typed. */
export const PICKS = ['date', 'time', 'check', 'pick'];

/** The tones a mark may take: each a colour the style names. */
export const TONES = ['accent', 'muted', 'ok', 'warn', 'bad', 'closed'];
const tone = oneOf(...TONES);
/** The items a mark lights on the canvas while the person points at it: the rest are faded (packs/walls/page/part-marks.css, hooks.lights). */
const lights = (v, why) => (Array.isArray(v) && v.length <= 500 ? v.map((i) => item(i, why)) : why('not a list of at most 500 items'));
/** What any mark may say: its key, the item or view it stands for, what it lights on the canvas and, on the page, its tip. */
const anyMark = { key, item, view, lights, tip: words(partLimits.label) };
/** An address the host draws a canvas at, as the page's own addresses are written: nothing that could break out of one. */
const ADDRESS = /^[A-Za-z0-9_~!*'().;:@&=+$,/?%#\[\]-]*$/;
const address = (v, why) => (typeof v === 'string' && v.length <= 2000 && ADDRESS.test(v) ? v : why('not an address of this page'));
/** A share of the room, above nothing and at most all of it. */
const share = (v, why) => (typeof v === 'number' && v > 0 && v <= 1 ? v : why('not a share above 0 and at most 1'));
/** What a box or a button may be when it stands for something the person moves or picks between (a tab). */
const handled = { drag: key, selected: flag, ring: flag, hue: words(partLimits.key), aux: flag };
/** A style preset tried on this screen alone, or null ('' too) for the workspace's own again. */
const tryOn = (v, why) => (v === null || v === '' ? '' : key(v, why));
/** A ghost's own id: its proposal and what in it (p_x:ref, p_x:#n, p_x:n). */
const GHOST = /^p_[a-z0-9]+:#?[A-Za-z0-9_.-]+$/;
const ghostId = (v, why) => (typeof v === 'string' && v.length <= partLimits.key && GHOST.test(v) ? v : why("not a ghost's id (p_x:ref, p_x:#n)"));
const proposal = (v, why) => (typeof v === 'string' && /^p_[a-z0-9]+$/.test(v) ? v : why("not a proposal's id"));
const rowId = (v, why) => (typeof v === 'string' && (/^[er]_[a-z0-9]{8}$/.test(v) || GHOST.test(v)) ? v : why("not an item's, a link's or a ghost's id"));
/** An item's or a link's id, as a step of a replay names what it plays. */
const ROW = /^[er]_[a-z0-9]{8}$/;
/** The steps of a replay: each the position of an entry of the log and the ids whose facts it plays. */
const replaySteps = (v, why) => {
  if (!Array.isArray(v) || v.length > partLimits.marks) return why(`not a list of at most ${partLimits.marks} steps`);
  let n = 0;
  return v.map((s) => {
    if (!plain(s) || !Number.isInteger(s.pos) || s.pos < 0 || !Array.isArray(s.ids)) return why('a step that is not { pos, ids }');
    if ((n += s.ids.length) > partLimits.marks * 10) return why('more ids than a replay may play');
    return { pos: s.pos, ids: s.ids.map((id) => (typeof id === 'string' && ROW.test(id) ? id : why("not an item's or a link's id"))) };
  });
};
/** Where a dragged mark may be let go: a side of a pane or its middle, the strip of tabs, or out of the page. */
export const DROP_ZONES = ['left', 'right', 'above', 'below', 'center', 'tabs', 'out'];

/**
 * Each kind: the attributes it may have and how each is read, what it may hold (`marks`, `words`, `drawn`: paths and
 * placed text, or nothing), whether it needs a key (what the person does to it goes back by it), and whether it lies
 * on a paint surface (`plane`) or on the page.
 */
export const MARKS = {
  box: { attrs: { ...anyMark, ...handled, look: oneOf('plain', 'band', 'sunk'), tone, flow: oneOf('row', 'column'), gap: step(0, 14), pad: step(0, 14), grow: flag, align: oneOf('start', 'center', 'end', 'between'), wrap: flag, fits: flag, more: key, dock: flag }, holds: 'marks' },
  text: { attrs: { ...anyMark, look: oneOf('body', 'title', 'muted', 'mark', 'code'), tone, size: step(1, 9), bold: flag, x: number, y: number, anchor: oneOf('start', 'middle', 'end'), href, hue: words(partLimits.key) }, holds: 'words' },
  list: { attrs: { ...anyMark, look: oneOf('plain', 'rows'), gap: step(0, 14) }, holds: 'marks' },
  input: { attrs: { key, tip: anyMark.tip, value: words(partLimits.words), hint: words(partLimits.label), label: words(partLimits.label), lines: step(1, 20), grow: flag, kind: oneOf(...INPUT_KINDS), values: wordList, names: wordList, look: oneOf('plain', 'title'), fits: flag, focus: flag, types: wordList, link: flag }, holds: 'nothing', keyed: true },
  button: { attrs: { ...anyMark, ...handled, look: oneOf('main', 'quiet', 'tab'), tone, label: words(partLimits.label), pick: oneOf('item', 'link'), copy: words(2000), try: tryOn }, holds: 'words', keyed: true },
  paint: { attrs: { key, tip: anyMark.tip, width: side, height: side, start: point, pixels: flag, controls: flag }, holds: 'drawn' },
  path: { attrs: { key, item, d: path, look: oneOf('line', 'fill', 'dash', 'area', 'box', 'strong'), tone, weight: step(1, 4), tip: words(partLimits.label), href }, holds: 'nothing', plane: true, needs: ['d'] },
  note: { attrs: { ...anyMark, tick: flag }, holds: 'words' },
  menu: { attrs: { ...anyMark, label: words(partLimits.label), look: oneOf('main', 'quiet'), open: flag }, holds: 'marks', only: ['button', 'box', 'text', 'list', 'input', 'menu'], needs: ['label'] },
  thumb: { attrs: { key, view, tip: anyMark.tip }, holds: 'nothing', needs: ['view'] },
  picture: { attrs: anyMark, holds: 'nothing', needs: ['item'] },
  web: { attrs: { key, tip: anyMark.tip, url: href, reload: words(partLimits.key) }, holds: 'nothing', needs: ['url'] },
  pane: { attrs: { key, tip: anyMark.tip, at: address, share, ring: flag, drag: key, selected: flag }, holds: 'marks', keyed: true, needs: ['at'] },
  panes: { attrs: { key, dir: oneOf('row', 'column') }, holds: 'marks', only: ['pane'], keyed: true },
  ghost: { attrs: { key, of: oneOf('item', 'link', 'mark'), id: ghostId, type: key, title: words(partLimits.label), status: key, body: words(4000), proposal, by: words(partLimits.label), reason: words(partLimits.label), op: oneOf('create', 'link', 'update', 'archive', 'unlink'), from: rowId, to: rowId, on: rowId }, holds: 'nothing', needs: ['of', 'proposal', 'op'] },
  replay: { attrs: { key, at: step(0, 1000000), steps: replaySteps }, holds: 'nothing', needs: ['at', 'steps'] },
  trace: { attrs: { key, item, tip: words(500), hue: words(partLimits.key) }, holds: 'nothing', needs: ['item'] },
  slot: { attrs: { key, name: slotName }, holds: 'nothing', needs: ['name'] },
  swatch: { attrs: { key, tip: anyMark.tip, preset: key, label: words(partLimits.label), on: oneOf('kept', 'trying') }, holds: 'nothing', needs: ['preset'] },
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
  if (kind === 'note' && at.tick && at.key === undefined) why('a note that ticks with no key: a tick goes back by its key');
  if (kind === 'text' && onPlane && at.hue !== undefined) why('a hue on text on a paint surface');
  if (kind === 'ghost') {
    const wants = { item: ['id', 'type', 'title'], link: ['id', 'type', 'from', 'to'], mark: ['on'] }[at.of];
    for (const name of wants) if (at[name] === undefined) why(`a ghost of ${a(at.of)} with no ${name}`);
    const ops = { item: ['create'], link: ['link'], mark: ['update', 'archive', 'unlink'] }[at.of];
    if (!ops.includes(at.op)) why(`a ghost of ${a(at.of)} that is ${at.op}: it is ${ops.join(' or ')}`);
  }
  if (kind === 'input' && (at.kind === 'pick') !== (at.values !== undefined)) why(at.values === undefined ? 'a pick with no values' : 'values on an input that is not a pick');
  if (kind === 'input' && at.names !== undefined && at.names.length !== (at.values ?? []).length) why('names that are not one for each value');
  if (kind === 'input' && at.kind !== 'item' && (at.types !== undefined || at.link !== undefined)) why('types or link on an input that finds no item');
  if (kind === 'input' && (PICKS.includes(at.kind) || at.kind === 'item') && (at.lines ?? 1) > 1) why(`lines on ${a(at.kind)}`);
  if (kind === 'text' && !onPlane && placed) why('x, y or anchor on text off a paint surface');
  if (at.more !== undefined && !at.fits) why('more on a box that does not fit: the count it names is drawn only by one that fits');
  if ((at.drag !== undefined || at.aux) && at.key === undefined) why(`${a(kind)} that is dragged or closed with no key: what is done to it goes back by its key`);
  for (const name of shape.needs ?? []) if (at[name] === undefined) why(`${a(kind)} with no ${name}`);
  if (kind === 'paint' && (at.width === undefined || at.height === undefined)) why('a paint surface with no width and height');
  if (shape.keyed && at.key === undefined) why(`${a(kind)} with no key: what the person does to it goes back by its key`);
  for (const k of [at.key, at.more]) if (k !== undefined) seen.keys.has(k) ? why(`the key "${k}" twice`) : seen.keys.add(k);
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
    // A pane is drawn by the panes that hold it, and holds in its strip only what names it.
    if (kind !== 'panes' && out.kids.some((k) => k.mark === 'pane')) why(`a pane in ${a(kind)}: panes hold panes`);
    if (kind === 'pane' && out.kids.some((k) => k.mark === 'panes')) why('panes in a pane: they stand side by side');
  }
  checked.add(out);
  return out;
}
