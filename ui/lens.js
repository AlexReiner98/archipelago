import { api, h, part } from './base.js';
import { drawFlow } from './flow.js';
import { drawGrid } from './grid.js';
import { dress } from './lens-base.js';
import { drawList } from './list.js';
import { drawCode } from './style-code.js';
import { drawTime } from './timeline.js';
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
      { class: 'card story', style: 'margin-bottom: 14px' },
      h('header', { class: 'toolbar fold-bar' }, h('h2', { title: 'What this session has found, as it last said it' }, 'Found'), h('span', { class: 'grow' }), ago(found.at)),
      said,
      h('div', { class: 'story-picture' }, picture),
    ),
    h(
      'details',
      { class: 'card wide fold story-beats', style: 'margin-bottom: 14px' },
      h('summary', { title: 'Each thing the session concluded, in order' }, h('h2', {}, 'How it got there'), h('span', { class: 'n' }, data.beats.filter((b) => !b.replaced_by).length)),
      h('ol', { class: 'beats' }, rows),
    ),
  ];
}

// ---- Lens ----------------------------------------------------------------

// A lens says what is in a picture and the server answers it with data of one
// shape (the `lens` view). A style says how that data looks, and is only ever
// read here: which shape, and what stays lit. The kernel draws four shapes:
// list, the default; flow, a process map; grid, rows by lanes; and time, along a
// time axis. Any other look is a style with code of its own, written for the
// project by its people or agents.
export const LENS_STYLE = { shape: 'list', lit: 'all' };
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
export function lensView({ lens = {}, style = {}, key = lens.story ? `story:${lens.story}` : (lens.from ?? 'map'), quiet = false, bare = false } = {}) {
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
  const load = async () => {
    let answer;
    try {
      answer = await api('view', { name: 'lens', params: { ...lens, ...place.ask } });
    } catch (err) {
      return body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
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
    // What holds the item, beside the view of its own it would open on: offered while some of what it waits on is
    // still open, and what an item with no view of its own opens on (with nothing beside it to switch to).
    const holding = answer.view === 'holding';
    if (!holding) place.home = views.find((view) => view.id === answer.view);
    const home = place.home;
    const parts = [
      // Its shortcuts: views that start somewhere else.
      views.filter((view) => view.to).map((view) => h('a', { class: 'chip lens-pin', href: `#/e/${view.to.id}`, title: `Goes to ${view.to.title}` }, view.title)),
      home && views.some((view) => view.id === 'holding') &&
        h(
          'span',
          { class: 'switch', title: 'What this picture shows' },
          h('button', { class: holding ? '' : 'on', onclick: again({ lens: home.id }) }, home.title),
          h('button', { class: holding ? 'on' : '', title: 'Everything it waits on, step by step, and nothing else', onclick: again({ lens: 'holding' }) }, 'What holds it'),
        ),
      h('span', { class: 'grow' }),
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
    Object.assign(chosen, LENS_STYLE, answer.style, keptStyle(key), style, { noLit: !answer.controls.includes('lit') });
    dress(body, chosen);
    // A style with code of its own is the drawing; without, one of those that come built in.
    // A lens on a time axis is drawn along it unless a shape is asked for here; a shape kept from before (nest, boxes) is drawn as the list.
    (typeof chosen.code === 'string' && chosen.code.trim() ? drawCode : (LENS_SHAPES[answer.lens.time && !style.shape ? 'time' : chosen.shape] ?? LENS_SHAPES.list))(body, answer, chosen, keep, place);
  };
  host.ready = load();
  // Light only these items (a beat's, pointed at beside the picture), or everything as the style says again: the shape draws itself anew.
  host.light = (ids) => {
    chosen.only = ids ? [...ids] : undefined;
    body.redraw?.();
  };
  return host;
}

export const lensPlace = new Map();

/** The shapes the kernel draws. Each reads only what a lens answers with. */
export const LENS_SHAPES = { list: drawList, flow: drawFlow, grid: drawGrid, time: drawTime };

/**
 * The map as a picture: the lens its address names (what follows a ?), or
 * the whole map as it opens, drawn in the style kept for it.
 */
export async function graph(query = '') {
  const { lens, style } = readLens(query);
  const view = lensView({ lens, style });
  // One already there stays until the new one is drawn: the map changing under it does not blank the page.
  if (part('graph').querySelector('.lens-wrap')) await view.ready;
  part('graph').replaceChildren(h('section', { class: 'card lens-card' }, view));
}
