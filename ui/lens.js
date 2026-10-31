import { api, h } from './base.js';
import { replicate } from './live.js';
import { unfollow } from './replica.js';
import { drawWith, drawings, warmDrawings } from './drawing.js';
import { dress } from './lens-base.js';
import { drawList } from './list.js';
import { drawCode } from './style-code.js';
import { saidDrawn } from './look.js';
import { ago, idsAsLinks, isA, titles } from './words.js';

/** On a map with nothing on it yet, a person is pointed at what puts something there. */
async function firstStep(body) {
  const info = await api('workspace_info').catch(() => null);
  if (info && !info.started) body.replaceChildren(h('div', { class: 'empty' }, 'Your map is empty. ', h('a', { href: '#/workspace?at=agent' }, 'Connect an agent')));
}

// ---- A session's story -----------------------------------------------------

// What a session has found, said whole, over a picture of only what that is
// about: a flat lens of the items the finding names, drawn as a list. How it got there, beat by beat (the tell tool),
// is folded under it: a log, for whoever wants it.
export function storyPart(data) {
  const found = data.beats.find((b) => b.n === data.finding);
  if (!found) return '';
  // What the finding is about, and nothing else: no walk.
  const picture = found.about.length ? flatView({ lens: { filter: { find: found.about.map((id) => `id ${id}`), not: [] } }, style: { shape: 'list' }, key: `story:${data.run.id}` }) : h('div', { hidden: true });
  // The finding names items by their ids; they read as names once the picture has said what each is called.
  const said = h('p', { class: 'finding' }, idsAsLinks(found.said));
  picture.ready?.then(() => {
    for (const item of picture.answer?.items ?? []) titles.set(item.id, item.title);
    said.replaceChildren(...idsAsLinks(found.said));
  });
  const named = (box, beat) => box?.replaceChildren(...beat.about.map((id) => h('a', { href: `#/e/${id}` }, titles.get(id) ?? 'an item')));
  const rows = data.beats.map((b) =>
    h(
      'li',
      { class: `beat${b.replaced_by ? ' taken-back' : ''}${b.finding ? ' found' : ''}` },
      h(
        'details',
        // What it is about is named when it is opened: by then the picture has said what each item is called.
        { ontoggle: (ev) => ev.target.open && named(ev.target.querySelector('.beat-items'), b) },
        h('summary', { title: b.said }, h('span', { class: 'n' }, b.n), h('span', { class: 'said' }, b.said), ago(b.at)),
        h(
          'div',
          { class: 'beat-more' },
          h('p', {}, b.said),
          b.replaced_by && h('p', { class: 'muted small' }, `Taken back in beat ${b.replaced_by}.`),
          b.about.length > 0 && h('div', { class: 'beat-items' }),
        ),
      ),
    ),
  );
  return [
    h(
      'section',
      { class: 'card story', style: 'margin-bottom: var(--space-8)' },
      h('header', { class: 'toolbar fold-bar' }, h('h2', { title: 'What this session has found, as it last said it' }, 'Found'), h('span', { class: 'grow' }), ago(found.at)),
      said,
      h('div', { class: 'story-picture' }, picture),
    ),
    h(
      'details',
      { class: 'card wide fold story-beats', style: 'margin-bottom: var(--space-8)' },
      h('summary', { title: 'Each thing the session concluded, in order' }, h('h2', {}, 'How it got there'), h('span', { class: 'n' }, data.beats.filter((b) => !b.replaced_by).length)),
      h('ol', { class: 'beats' }, rows),
    ),
  ];
}

// ---- Lens ----------------------------------------------------------------

// A lens says what is in a picture (the flat lens: a filter, a walk and a limit) and the server answers it with data
// of one shape (the `flat` view). A style says how that data looks, and is only ever read here: which shape, and what
// stays lit. The kernel draws the list; the core pack's drawings draw flow, a process map, and architecture, a
// system's parts, where they run and their wires. Any other look is a style with code of its own, written for the
// project by its people or agents.

/** What a person chose for a picture is kept in their browser, by what it is a picture of. */
export const keptStyle = (key) => {
  try {
    return JSON.parse(localStorage.getItem(`pelago-lens:${key}`) ?? '{}');
  } catch {
    return {};
  }
};

/** The shapes the kernel draws. Each reads only what a lens answers with. */
export const LENS_SHAPES = { list: drawList };

// ---- The flat lens: a filter, a walk and a limit (decision e_sdsaxxq4) ------------------------------------------

/** The links an item is drawn with when the canvas opens on it: what is in it, what it depends on and waits on. */
export const FOCUS = ['part_of', 'depends_on', 'waits_on'];
const list = (value) => (value ?? '').split(',').filter(Boolean);

/**
 * A flat lens and a style, as the end of an address says them: ?find=type task&find=in e_p&only=done&not=kind system
 * &over=part_of&steps=1&limit=500&time=-6d,7d (each term its own find, only or not; time is a window each item is placed in, its ends
 * dates or days from today; not with nothing after it leaves nothing out). An
 * address from before the flat lens (?from=e_x) opens on that item. A lens that includes nothing is null, unless the
 * address says so (`nothing`: every Find term taken out, drawn as an empty canvas). `canvas` names
 * the saved canvas it is drawn on (ui/canvases.js): its places, its name in the bar.
 */
export function readFlatLens(query) {
  const p = new URLSearchParams(query);
  const filter = {};
  const named = list(p.get('from')).map((id) => `id ${id}`);
  if (named.length || p.getAll('find').length) filter.find = [...new Set([...named, ...p.getAll('find').filter(Boolean)])];
  if (p.getAll('only').length) filter.only = p.getAll('only').filter(Boolean);
  if (p.has('not')) filter.not = p.getAll('not').filter(Boolean);
  const style = {};
  for (const key of ['lit', 'shape', 'style', 'canvas']) if (p.get(key)) style[key] = p.get(key);
  // A lens that names a view draws its answer in place of what a filter finds (the plan pack's usage).
  if (p.get('view')) return { lens: { view: p.get('view'), filter: {}, walk: { over: [], steps: 0 } }, style };
  if (!includesAny(filter) && !p.has('nothing')) return { lens: null, style };
  const over = p.get('over') === 'all' ? 'all' : p.has('over') ? list(p.get('over')) : p.has('from') ? FOCUS : [];
  const lens = { filter, walk: { over, steps: p.has('steps') ? Number(p.get('steps')) : over.length ? 1 : 0 } };
  if (p.has('limit')) lens.limit = Number(p.get('limit'));
  const [from, to] = list(p.get('time'));
  if (from && to) lens.time = { from, to };
  return { lens, style };
}

/** Whether a filter includes anything: one that does not is answered with nothing, here, never sent to be read. */
export const includesAny = (f) => Boolean(f.find?.length);

/** The end of the address that says this flat lens (and the style asked of it): what readFlatLens reads back. */
export function flatQuery(lens, style = {}) {
  const p = new URLSearchParams();
  if (lens.view) p.set('view', lens.view);
  else if (!includesAny(lens.filter)) p.set('nothing', '');
  const { find, only, not } = lens.filter;
  for (const term of find ?? []) p.append('find', term);
  for (const term of only ?? []) p.append('only', term);
  if (not) {
    if (!not.length) p.set('not', '');
    for (const term of not) p.append('not', term);
  }
  const { over, steps } = lens.walk ?? { over: [], steps: 0 };
  if (over === 'all' || over.length) p.set('over', over === 'all' ? 'all' : over.join(','));
  if (steps || over === 'all' || over.length) p.set('steps', String(steps));
  if (lens.limit) p.set('limit', String(lens.limit));
  if (lens.time) p.set('time', `${lens.time.from},${lens.time.to}`);
  for (const key of ['lit', 'shape', 'style', 'canvas']) if (style[key]) p.set(key, style[key]);
  return p.toString();
}

/**
 * A flat answer as the drawings made for the old lens read it, until each reads the flat answer itself (the flat flow
 * is being built beside this): what the old answer counted of each item, nothing, and each link's type as its kind.
 * Only adds fields: a drawing that reads the flat answer is given it as it is.
 */
const asDrawn = (answer) => ({
  ...answer,
  items: answer.items.map((i) => ({ state: { needs_you: false, blocked: false, sessions: 0, waits_on: [] }, within: { items: 0, needs_you: 0, blocked: 0, work: 0, sessions: 0 }, size: { work: 0 }, ...i })),
  links: answer.links.map((l) => ({ kind: l.type, ...l })),
});

/**
 * An answer with what each item is inside, for the drawings that nest (architecture, grid, a list's groups): the item
 * it is part of, where that is drawn too; the part_of link that says so is said by inside, not drawn as well. `from`
 * is the item the picture starts from, which such a drawing draws as the frame (the lens's from, as before the flat lens).
 */
const nested = (answer, from) => {
  const ids = new Set(answer.items.map((i) => i.id));
  const inside = new Map();
  for (const k of answer.links) if (k.type === 'part_of' && ids.has(k.to) && k.from !== k.to && !inside.has(k.from)) inside.set(k.from, k);
  return { ...answer, ...(from && { lens: { ...answer.lens, from } }), items: answer.items.map((i) => ({ ...i, inside: inside.get(i.id)?.to ?? null })), links: answer.links.filter((k) => inside.get(k.from) !== k) };
};

/** An answer with only the items of these types (flavours included), and the links among them. */
const narrowed = (only) => (answer) => {
  const items = answer.items.filter((i) => only.some((t) => isA(i.type, t)));
  const ids = new Set(items.map((i) => i.id));
  return { ...answer, items, links: answer.links.filter((k) => ids.has(k.from) && ids.has(k.to)) };
};

/** The styles asked for (by what was asked) whose drawing reads each note whole. */
const whole = new Set();

/**
 * The canvas's picture of a flat lens: its answer (items and the links among them) drawn with the style of what it
 * opens on (`of`), by the drawing that style names. `only` draws the items of those types alone (a pack's picture of
 * one kind of thing); `nest` (true, or the item it starts from) says what each item is inside, from the part_of links among them (a kept view, drawn as
 * it was before the flat lens); `extra` is drawn with the answer (a kept view's steps); `quiet` hides the card it is in when there
 * is nothing to draw. `refresh` asks again and draws
 * again only when the answer differs; `mark` lights the item whose page is open.
 */
export function flatView({ lens, style = {}, of, key, only, nest = false, extra, quiet = false }) {
  const chosen = {};
  const body = h('div', { class: 'lens-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const host = h('div', { class: 'lens-wrap' }, body);
  const place = { opened: new Map(), ask: {} };
  const keep = (change) => Object.assign(chosen, change);
  let look;
  let raw;
  // Asked of a drawing that reads each note whole (the pages: `notes` on the drawing), the lens is read with them.
  const asked = JSON.stringify([of, style.style, style.canvas, style.shape]);
  // The answer is held in a store kept current from the log (ui/replica.js): facts redraw it without the lens being
  // read again; only a link made to something it does not hold reads the lens again, since the walk may now reach more.
  // What is drawn is the answer with what is held for the owner and the links drawn here not yet answered for drawn
  // into it (`shown`, ui/ghosts.js); what the canvas holds (`host.answer`) is the answer alone.
  const draw = (answer, shown, refreshing) => {
    if (only) [answer, shown] = [answer, shown].map(narrowed(only));
    if (extra) [answer, shown] = [answer, shown].map((a) => ({ ...a, ...extra }));
    if (nest) shown = nested(shown, typeof nest === 'string' ? nest : undefined);
    const said = JSON.stringify(shown);
    if (refreshing && said === host.said) return;
    host.said = said;
    host.answer = answer;
    host.failed = null;
    for (const item of answer.items) titles.set(item.id, item.title);
    host.dispatchEvent(new CustomEvent('lens-answer'));
    if (quiet) (host.closest('.lens-card') ?? host).hidden = !answer.items.length;
    if (!answer.items.length && quiet) return;
    if (!answer.items.length) {
      body.replaceChildren(h('div', { class: 'empty' }, 'Nothing to draw with this lens.'));
      firstStep(body);
      return saidDrawn(body, 'empty');
    }
    for (const name of Object.keys(chosen)) delete chosen[name];
    Object.assign(chosen, look.style, keptStyle(key), style, { noLit: true });
    dress(body, chosen);
    const drawn = chosen.drawing && (chosen.drawing.shape ?? chosen.shape) === chosen.shape;
    const coded = typeof chosen.code === 'string' && chosen.code.trim();
    (coded ? drawCode : drawn ? drawWith : (LENS_SHAPES[chosen.shape] ?? LENS_SHAPES.list))(body, asDrawn(shown), chosen, keep, place, look.coder);
    // A drawing or a style's code says when it has drawn; a shape drawn here has drawn now.
    if (!coded && !drawn) saidDrawn(body, 'drawn');
  };
  const load = async (refreshing = false) => {
    if (lens.view) return loadView(refreshing);
    // A lens that includes nothing draws nothing: the server would refuse it, as never the whole map.
    if (!includesAny(lens.filter)) {
      host.answer = { items: [], links: [], lens };
      host.failed = null;
      host.dispatchEvent(new CustomEvent('lens-answer'));
      body.replaceChildren();
      firstStep(body);
      return saidDrawn(body, 'empty');
    }
    let store;
    try {
      [store, look] = await Promise.all([
        replicate(async () => (raw = await api('view', { name: 'flat', params: { ...lens, ...(whole.has(asked) && { notes: 'whole' }) } }))),
        api('view', { name: 'style', params: { ...(of && { of }), ...(style.style && { style: style.style }), ...(style.canvas && { view: style.canvas }), ...(style.shape && { shape: style.shape }), have: [...drawings.keys()] } }),
      ]);
    } catch (err) {
      host.failed = err.message;
      host.dispatchEvent(new CustomEvent('lens-answer'));
      saidDrawn(body, 'error', err.message);
      return refreshing || body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    // Read once more, the first time a style's drawing is found to want whole notes; from then on they are asked at once.
    if (look.style?.drawing?.notes === 'whole' && !whole.has(asked)) {
      whole.add(asked);
      unfollow(store);
      return load(refreshing);
    }
    if (host.store) unfollow(host.store);
    host.store = store;
    store.on((changed) => {
      if (host.store !== store) return;
      if (!host.isConnected) return unfollow(store);
      // On a time axis an item changed may fall elsewhere: where is the server's to work out, so the lens is read again.
      if (changed.missing.length || (lens.time && changed.items.changed.length)) return load(true);
      draw({ ...raw, ...store.answer() }, { ...raw, ...store.drawn() }, true);
    });
    draw({ ...raw, ...store.answer() }, { ...raw, ...store.drawn() }, refreshing);
  };
  // A lens that names a view: its answer, asked as an agent asks it, is drawn as it comes. It is not a replica of the
  // log (what it measures is not all facts), so it is asked again when the canvas is drawn again or refreshed.
  const loadView = async (refreshing) => {
    try {
      [raw, look] = await Promise.all([
        api('view', { name: lens.view }),
        api('view', { name: 'style', params: { ...(of && { of }), ...(style.style && { style: style.style }), ...(style.canvas && { view: style.canvas }), ...(style.shape && { shape: style.shape }), have: [...drawings.keys()] } }),
      ]);
    } catch (err) {
      host.failed = err.message;
      host.dispatchEvent(new CustomEvent('lens-answer'));
      saidDrawn(body, 'error', err.message);
      return refreshing || body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    draw(raw, raw, refreshing);
  };
  warmDrawings();
  host.ready = load();
  host.refresh = () => load(true);
  // A drawing that made something asks for the lens again: a new item is not among those the store follows.
  host.addEventListener('lens-read', () => load(true));
  host.mark = (id) => {
    style.here = chosen.here = id;
    body.redraw?.();
  };
  return host;
}
