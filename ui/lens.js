import { api, h } from './base.js';
import { replicate } from './live.js';
import { unfollow } from './replica.js';
import { drawing as redraw } from './settle.js';
import { drawWith, drawings, warmDrawings } from './drawing.js';
import { dress } from './lens-base.js';
import { drawList } from './list.js';
import { drawCode } from './style-code.js';
import { ago, idsAsLinks, titles } from './words.js';

// ---- A session's story -----------------------------------------------------

// What a session has found, said whole, over a picture of only what that is
// about: a lens started from the story's finding, drawn as a list with its ties
// written after each name. How it got there, beat by beat (the tell tool),
// is folded under it: a log, for whoever wants it.
export function storyPart(data) {
  const found = data.beats.find((b) => b.n === data.finding);
  if (!found) return '';
  const picture = lensView({ lens: { story: data.run.id, beat: found.n }, style: { shape: 'list' }, key: `story:${data.run.id}`, bare: true });
  // The finding names items by their ids; they read as names once the picture has said what each is called.
  const said = h('p', { class: 'finding' }, idsAsLinks(found.said));
  picture.ready.then(() => {
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

// A lens says what is in a picture and the server answers it with data of one
// shape (the `lens` view). A style says how that data looks, and is only ever
// read here: which shape, and what stays lit. The kernel draws three shapes: list (the core pack's house style); grid,
// rows by lanes; time, along a time axis. The core pack's drawings draw flow, a process map, and architecture, a
// system's parts, where they run and their wires. Any other look is a style with code of its own, written for the
// project by its people or agents.
/** The views every item may have beside its own, by the id the server gives each, with what each shows. */
const BUILT_IN = { holding: 'Everything it waits on, step by step, and nothing else', when: 'When what is in it happens, by day, each person a lane' };
/** A date some days on. */
const dayAfter = (date, n) => new Date(Date.parse(`${date.slice(0, 10)}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortDay = (date) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** The fields a lens may carry in an address, and which of them are lists. */
export const LENS_FIELDS = { from: false, story: false, by: false, far: false, lanes: false, order: false, measure: false, kinds: true, over: true, fold: true };

/** A lens and a style, as the end of an address says them: ?from=…&far=1&lit=you. */
export function readLens(query) {
  const lens = {};
  const style = {};
  for (const [key, value] of new URLSearchParams(query)) {
    // here: the item a picture was opened from, marked in it.
    if (key === 'lit' || key === 'shape' || key === 'here') style[key] = value;
    // A lens or a style kept on the map, named outright: the server reads it.
    else if ((key === 'lens' || key === 'style') && value) lens[key] = value;
    else if (!(key in LENS_FIELDS)) continue;
    else if (key === 'far') lens.far = Number(value);
    else if (key === 'over' && value === 'all') lens.over = 'all';
    else lens[key] = LENS_FIELDS[key] ? value.split(',').filter(Boolean) : value;
  }
  return { lens, style };
}

/** What a person chose for a picture is kept in their browser, by what it is a picture of. */
export const keptStyle = (key) => {
  try {
    return JSON.parse(localStorage.getItem(`pelago-lens:${key}`) ?? '{}');
  } catch {
    return {};
  }
};

/**
 * The picture a lens gives, drawn in a style, under a bar that says what it
 * is a picture of: the views kept about the item (the first is the one it
 * opens on), its shortcuts, what this view lets the person change, and the
 * view's rule in words. `style` is what the page or an address asks for this
 * one look, over what the person chose before.
 */
export function lensView(opts = {}) {
  const asked = JSON.stringify(opts);
  const live = onPage.get(asked);
  if (!redraw.inPlace || !live?.isConnected) {
    const host = drawLens(opts);
    host.dataset.lensKey = asked;
    onPage.set(asked, host);
    return host;
  }
  // Drawn again in place with all it was asked the same: the picture on the page stays, and only asks again.
  const mark = h('div', { 'data-keep': asked });
  Object.assign(mark, { make: () => (onPage.delete(asked), lensView(opts)), ready: live.refresh(), light: (ids) => live.light(ids) });
  Object.defineProperty(mark, 'answer', { get: () => live.answer });
  return mark;
}
/** The pictures drawn, by all each was asked with. */
const onPage = new Map();

function drawLens({ lens = {}, style = {}, key = lens.story ? `story:${lens.story}` : (lens.from ?? 'map'), quiet = false, bare = false }) {
  const chosen = {};
  const bar = h('div', { class: 'toolbar fold-bar lens-bar', hidden: true });
  const body = h('div', { class: 'lens-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const host = h('div', { class: 'lens-wrap' }, bar, body);
  // What was opened, where the picture stood and which view was chosen outlive a redraw: the map changes under an open page.
  if (!lensPlace.has(key)) lensPlace.set(key, { opened: new Map(), ask: {} });
  const place = lensPlace.get(key);
  const keep = (change) => {
    Object.assign(chosen, change);
    try {
      localStorage.setItem(`pelago-lens:${key}`, JSON.stringify({ lit: chosen.lit }));
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  };
  const load = async (refreshing = false) => {
    let answer;
    try {
      answer = await api('view', { name: 'lens', params: { ...lens, ...place.ask, have: [...drawings.keys()] } });
    } catch (err) {
      return refreshing || body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    // Asked again with the map changed somewhere: a picture whose answer is the same is left as it is (a story playing on).
    const said = JSON.stringify(answer, (k, v) => (k === 'modules' ? undefined : v));
    if (refreshing && said === host.said) return;
    host.said = said;
    host.answer = answer;
    const views = answer.views ?? [];
    // From an item, the item itself is one of them; over the whole map, there is no such one.
    const empty = answer.items.length < (lens.from || lens.lens ? 2 : 1);
    if (empty && !views.length && quiet) return void ((host.closest('.lens-card') ?? host).hidden = true);
    const again = (change) => () => (Object.assign(place.ask, change), load());
    const far = answer.lens.far;
    const finished = !answer.lens.fold.includes('closed');
    // The picture is the one the item opens on, as its owner or their agent made it: no other views offered beside it, and
    // nothing to change on it but what its lens offers. Its rule in words is the bar's tooltip.
    // Beside the view of its own it would open on (or what is in it, when it has none): the views every item may have,
    // what holds it (while some of what it waits on is open) and when what is in it happens (while any of it is dated).
    const builtIn = views.filter((view) => view.id in BUILT_IN);
    const current = answer.view in BUILT_IN ? answer.view : null;
    if (!current) place.home = views.find((view) => view.id === answer.view) ?? null;
    const home = place.home;
    const time = answer.lens.time;
    const days = time && Math.round((Date.parse(time.to) - Date.parse(time.from)) / 86_400_000) + 1;
    const shift = (n) => again({ time: { from: dayAfter(time.from, n * days), to: dayAfter(time.to, n * days) } });
    const parts = [
      // Its shortcuts: views that start somewhere else.
      views.filter((view) => view.to).map((view) => h('a', { class: 'chip lens-pin', href: `#/e/${view.to.id}`, title: `Goes to ${view.to.title}` }, view.title)),
      lens.from && builtIn.length > 0 &&
        h(
          'span',
          { class: 'switch', title: 'What this view shows' },
          h('button', { class: current ? '' : 'on', onclick: again({ lens: home?.id ?? 'in', time: undefined }) }, home?.title ?? 'What is in it'),
          builtIn.map((view) => h('button', { class: current === view.id ? 'on' : '', title: BUILT_IN[view.id], onclick: again({ lens: view.id, time: undefined }) }, view.title)),
        ),
      h('span', { class: 'grow' }),
      answer.controls.includes('time') && time &&
        h(
          'span',
          { class: 'switch', title: 'Which days are drawn' },
          h('button', { title: 'Earlier', onclick: shift(-1) }, '‹'),
          h('button', { class: 'on', title: `${time.from} to ${time.to}` }, `${shortDay(time.from)} – ${shortDay(time.to)}`),
          h('button', { title: 'Later', onclick: shift(1) }, '›'),
        ),
      answer.controls.includes('far') &&
        h(
          'span',
          { class: 'switch', title: 'How many steps down are drawn' },
          h('button', { title: 'One step fewer', disabled: far === 0, onclick: again({ far: Math.max((far ?? 4) - 1, 0) }) }, '−'),
          h('button', { class: 'on', title: 'How many steps down are drawn' }, far === undefined ? 'All' : String(far)),
          h('button', { title: 'One step more', onclick: again({ far: (far ?? 0) + 1 }) }, '+'),
        ),
      answer.controls.includes('closed') && h('button', { class: finished ? 'on' : '', title: finished ? 'Leave out what is finished' : 'Show what is finished too', onclick: again({ fold: finished ? [...answer.lens.fold, 'closed'] : answer.lens.fold.filter((f) => f !== 'closed') }) }, 'Finished'),
    ];
    bar.replaceChildren(...parts.flat().filter(Boolean));
    bar.title = answer.said;
    // A picture that says what it is in words of its own (a finding) has no bar over it, and is not there when it has nothing to draw; nor has one with nothing on its bar.
    bar.hidden = bare || bar.children.length < 2;
    if (empty && bare) return void (host.hidden = true);
    if (empty) return body.replaceChildren(h('div', { class: 'empty' }, 'Nothing to draw with this view.'));
    // Nearest wins, field by field: built in, what the map keeps for this view, what this person chose, what the address asks.
    for (const name of Object.keys(chosen)) delete chosen[name];
    Object.assign(chosen, answer.style, keptStyle(key), style, { noLit: !answer.controls.includes('lit') });
    dress(body, chosen);
    // A style with code of its own is the drawing; without, one of those that come built in.
    // A lens on a time axis is drawn along it unless a shape is asked for here; a shape kept from before (nest, boxes) is drawn as the list.
    // A drawing draws the shape it is for; a drawing kept from before that names none, whatever the map keeps.
    const shape = answer.lens.time && !style.shape ? 'time' : chosen.shape;
    const drawn = chosen.drawing && (chosen.drawing.shape ?? chosen.shape) === shape;
    (typeof chosen.code === 'string' && chosen.code.trim() ? drawCode : drawn ? drawWith : (LENS_SHAPES[shape] ?? LENS_SHAPES.list))(body, answer, chosen, keep, place);
  };
  // The frame drawings run in is started while the answer is on its way.
  warmDrawings();
  host.ready = load();
  host.refresh = () => load(true);
  // Light only these items (a beat's, pointed at beside the picture), or everything as the style says again: the shape draws itself anew.
  host.light = (ids) => {
    chosen.only = ids ? [...ids] : undefined;
    body.redraw?.();
  };
  // Mark one item as the one whose page is open, or none: kept over a refresh, as the page asked for it.
  host.mark = (id) => {
    style.here = chosen.here = id;
    body.redraw?.();
  };
  return host;
}

export const lensPlace = new Map();

/** The shapes the kernel draws. Each reads only what a lens answers with. */
export const LENS_SHAPES = { list: drawList };

// ---- The flat lens: a filter, a walk and a limit (decision e_sdsaxxq4) ------------------------------------------

/** The links an item is drawn with when the canvas opens on it: what is in it, what it depends on and waits on. */
export const FOCUS = ['part_of', 'depends_on', 'waits_on'];
const list = (value) => (value ?? '').split(',').filter(Boolean);

/**
 * A flat lens and a style, as the end of an address says them: ?text=…&types=…&ids=…&link=tagged e_x&exclude=closed
 * &over=part_of&steps=1&limit=500 (a link term each `link`; exclude with nothing after it leaves nothing out). An
 * address from before the flat lens (?from=e_x) opens on that item. A lens that includes nothing is null.
 */
export function readFlatLens(query) {
  const p = new URLSearchParams(query);
  const filter = {};
  const ids = [...list(p.get('from')), ...list(p.get('ids'))];
  if (p.get('text')?.trim()) filter.text = p.get('text').trim();
  if (p.get('types')) filter.types = list(p.get('types'));
  if (ids.length) filter.ids = [...new Set(ids)];
  if (p.getAll('link').length) filter.links = p.getAll('link').filter(Boolean);
  if (p.has('exclude')) filter.exclude = list(p.get('exclude'));
  const style = {};
  for (const key of ['lit', 'shape', 'style']) if (p.get(key)) style[key] = p.get(key);
  if (!filter.text && !filter.types?.length && !filter.ids?.length && !filter.links?.length) return { lens: null, style };
  const over = p.get('over') === 'all' ? 'all' : p.has('over') ? list(p.get('over')) : p.has('from') ? FOCUS : [];
  const lens = { filter, walk: { over, steps: p.has('steps') ? Number(p.get('steps')) : over.length ? 1 : 0 } };
  if (p.has('limit')) lens.limit = Number(p.get('limit'));
  return { lens, style };
}

/** The end of the address that says this flat lens (and the style asked of it): what readFlatLens reads back. */
export function flatQuery(lens, style = {}) {
  const p = new URLSearchParams();
  const { text, types, ids, links, exclude } = lens.filter;
  if (text) p.set('text', text);
  if (types?.length) p.set('types', types.join(','));
  if (ids?.length) p.set('ids', ids.join(','));
  for (const term of links ?? []) p.append('link', term);
  if (exclude) p.set('exclude', exclude.join(','));
  const { over, steps } = lens.walk ?? { over: [], steps: 0 };
  if (over === 'all' || over.length) p.set('over', over === 'all' ? 'all' : over.join(','));
  if (steps || over === 'all' || over.length) p.set('steps', String(steps));
  if (lens.limit) p.set('limit', String(lens.limit));
  for (const key of ['lit', 'shape', 'style']) if (style[key]) p.set(key, style[key]);
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
 * The canvas's picture of a flat lens: its answer (items and the links among them) drawn with the style of what it
 * opens on (`of`), by the drawing that style names. `refresh` asks again and draws again only when the answer
 * differs; `mark` lights the item whose page is open.
 */
export function flatView({ lens, style = {}, of, key }) {
  const chosen = {};
  const body = h('div', { class: 'lens-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const host = h('div', { class: 'lens-wrap' }, body);
  const place = { opened: new Map(), ask: {} };
  const keep = (change) => Object.assign(chosen, change);
  let look;
  let raw;
  // The answer is held in a store kept current from the log (ui/replica.js): facts redraw it without the lens being
  // read again; only a link made to something it does not hold reads the lens again, since the walk may now reach more.
  // What is drawn is the answer with what is held for the owner and the links drawn here not yet answered for drawn
  // into it (`shown`, ui/ghosts.js); what the canvas holds (`host.answer`) is the answer alone.
  const draw = (answer, shown, refreshing) => {
    const said = JSON.stringify(shown);
    if (refreshing && said === host.said) return;
    host.said = said;
    host.answer = answer;
    host.failed = null;
    for (const item of answer.items) titles.set(item.id, item.title);
    host.dispatchEvent(new CustomEvent('lens-answer'));
    if (!answer.items.length) return body.replaceChildren(h('div', { class: 'empty' }, 'Nothing to draw with this lens.'));
    for (const name of Object.keys(chosen)) delete chosen[name];
    Object.assign(chosen, look.style, keptStyle(key), style, { noLit: true });
    dress(body, chosen);
    const drawn = chosen.drawing && (chosen.drawing.shape ?? chosen.shape) === chosen.shape;
    (typeof chosen.code === 'string' && chosen.code.trim() ? drawCode : drawn ? drawWith : (LENS_SHAPES[chosen.shape] ?? LENS_SHAPES.list))(body, asDrawn(shown), chosen, keep, place);
  };
  const load = async (refreshing = false) => {
    let store;
    try {
      [store, look] = await Promise.all([
        replicate(async () => (raw = await api('view', { name: 'flat', params: lens }))),
        api('view', { name: 'style', params: { ...(of && { of }), ...(style.style && { style: style.style }), have: [...drawings.keys()] } }),
      ]);
    } catch (err) {
      host.failed = err.message;
      host.dispatchEvent(new CustomEvent('lens-answer'));
      return refreshing || body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    if (host.store) unfollow(host.store);
    host.store = store;
    store.on((changed) => {
      if (host.store !== store) return;
      if (!host.isConnected) return unfollow(store);
      if (changed.missing.length) return load(true);
      draw({ ...raw, ...store.answer() }, { ...raw, ...store.drawn() }, true);
    });
    draw({ ...raw, ...store.answer() }, { ...raw, ...store.drawn() }, refreshing);
  };
  warmDrawings();
  host.ready = load();
  host.refresh = () => load(true);
  host.mark = (id) => {
    style.here = chosen.here = id;
    body.redraw?.();
  };
  return host;
}
