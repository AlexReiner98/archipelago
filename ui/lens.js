import { api, h, part } from './base.js';
import { BLOCKING, isOf } from './graph.js';
import { drawGrid } from './grid.js';
import { drawCode, drawNest } from './nest.js';
import { drawTime } from './timeline.js';
import { ago, idsAsLinks, link, relations, titles, typeTitle } from './words.js';

// ---- A session's story -----------------------------------------------------

// What a session has found, said whole, over a picture of only what that is
// about: a lens started from the story's finding, drawn with its ties (the
// nest, which draws lines). How it got there, beat by beat (the tell tool),
// is folded under it: a log, for whoever wants it.
export function storyPart(data) {
  const found = data.beats.find((b) => b.n === data.finding);
  if (!found) return '';
  const picture = lensView({ lens: { story: data.run.id, beat: found.n }, style: { shape: 'nest' }, key: `story:${data.run.id}`, bare: true });
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
// read here: which shape, and what stays lit. One shape so far, the nest: a
// thing is a circle and what is inside it is in it, at every depth. It opens
// as it grows on the screen, and closed it says of its parts what each part
// says of itself, so every zoom is the same drawing at another scale.
export const LENS_STYLE = { shape: 'nest', lit: 'all' };
export const LIT = [
  ['all', 'All', 'Everything in the picture'],
  ['you', 'Needs you', 'Only what waits on you stays lit'],
  ['blocked', 'Blocked', 'Only what is blocked stays lit'],
];
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
    const pictures = views.filter((view) => !view.to);
    const far = answer.lens.far;
    const finished = !answer.lens.fold.includes('closed');
    const parts = [
      // The views of the item, one click apart.
      pictures.length > 1 && h('span', { class: 'switch' }, pictures.map((view) => h('button', { class: view.id === answer.view ? 'on' : '', title: view.title, onclick: again({ lens: view.id, far: undefined, fold: undefined }) }, view.title))),
      // Its shortcuts: views that start somewhere else.
      views.filter((view) => view.to).map((view) => h('a', { class: 'chip lens-pin', href: `#/e/${view.to.id}`, title: `Goes to ${view.to.title}` }, view.title)),
      // The rule of this view, in words: what is in the picture and what is not.
      h('span', { class: 'lens-rule grow', title: answer.said }, answer.said),
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
    // A picture that says what it is in words of its own (a finding) has no bar of rules over it, and is not there when it has nothing to draw.
    bar.hidden = bare;
    if (empty && bare) return void (host.hidden = true);
    if (empty) return body.replaceChildren(h('div', { class: 'empty' }, 'Nothing to draw with this view.'));
    // Nearest wins, field by field: built in, what the map keeps for this view, what this person chose, what the address asks.
    for (const name of Object.keys(chosen)) delete chosen[name];
    Object.assign(chosen, LENS_STYLE, answer.style, keptStyle(key), style, { noLit: !answer.controls.includes('lit') });
    dress(body, chosen);
    // A style with code of its own is the drawing; without, one of those that come built in.
    (typeof chosen.code === 'string' && chosen.code.trim() ? drawCode : (LENS_SHAPES[answer.lens.time && !style.shape ? 'time' : chosen.shape] ?? LENS_SHAPES.nest))(body, answer, chosen, keep, place);
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

/** A style's colours and sizes, by the name the stylesheet knows each by, with the range a size may take. */
export const STYLE_COLORS = ['sea', 'land', 'inner', 'line', 'text', 'muted', 'blocked', 'you', 'session', 'done'];
export const STYLE_SIZES = { text: [9, 22], radius: [0, 40], gap: [0, 40], column: [140, 640] };
/** A style's colours and sizes are handed to the stylesheet. Only a plain hex colour or a number in range is: a style is written by anyone who can change the map. */
export function dress(host, style) {
  for (const name of STYLE_COLORS) {
    const colour = style.colors?.[name];
    if (typeof colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(colour)) host.style.setProperty(`--ln-${name}`, colour);
    else host.style.removeProperty(`--ln-${name}`);
  }
  for (const [name, [least, most]] of Object.entries(STYLE_SIZES)) {
    if (Number.isFinite(style[name])) host.style.setProperty(`--ln-${name}-size`, `${Math.max(least, Math.min(most, style[name]))}px`);
    else host.style.removeProperty(`--ln-${name}-size`);
  }
}

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it: the same numbers at every depth. */
export function lensTree(answer) {
  const me = answer.viewer;
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], depth: -1, x: 0, y: 0, title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(Object.assign(n, { up: byId.get(n.inside) ?? root }));
  for (const n of byId.values()) {
    n.all = 1 + n.within.items;
    n.you = (me && n.state.waits_on.includes(me) ? 1 : 0) + ((me && n.within.waits_on[me]) || 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
    n.work = n.size.work + n.within.work;
    n.at = n.state.sessions + n.within.sessions;
  }
  const deepen = (n, depth) => ((n.depth = depth), n.kids.sort((a, b) => a.place - b.place).forEach((kid) => deepen(kid, depth + 1)));
  deepen(root, -1);
  return { me, byId, root };
}

/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says; a thing that holds others, by what is in it. */
export function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (m) => only.has(m.id) || m.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}

/** The switch for what stays lit, the same in every shape. */
export function litSwitch(me, style, keep, redraw) {
  // A view that does not offer the choice has no switch.
  if (style.noLit) return '';
  const lit = h('span', { class: 'switch' });
  for (const [value, label, title] of LIT) {
    if (value === 'you' && !me) continue;
    lit.append(h('button', { class: style.lit === value ? 'on' : '', title, onclick: (ev) => (keep({ lit: value }), [...lit.children].forEach((b) => b.classList.toggle('on', b === ev.currentTarget)), redraw()) }, label));
  }
  return lit;
}

/** Boxes: a thing is a titled box, what is inside it is in it, and a thing with nothing inside is one line. Reads only what a lens answers with. */
export function drawBoxes(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const show = new Set(Array.isArray(style.show) ? style.show : ['you', 'blocked', 'count']);
  const levels = Number.isFinite(style.open) ? style.open : 1;
  const { opened } = kept;
  // Around one item, what it sits in is open down to it, and how far things open is counted from it.
  const here = byId.get(answer.lens.from);
  const above = new Set();
  for (let n = here?.up; n && n !== root; n = n.up) above.add(n.id);
  const base = here?.depth ?? 0;
  // What each thing waits on, by name, for its tooltip.
  const waits = new Map();
  for (const link of answer.links) if (isOf(BLOCKING, link.kind) && byId.has(link.to)) waits.set(link.from, [...(waits.get(link.from) ?? []), byId.get(link.to).title]);
  // What a session said ties a thing to another is written on its line, after its name: boxes draw no lines.
  const ties = new Map();
  for (const link of answer.links) if (link.says && byId.has(link.to)) ties.set(link.from, [...(ties.get(link.from) ?? []), `${link.says} → ${byId.get(link.to).title}`]);
  const tied = (n) => ties.has(n.id) && h('span', { class: 'lb-said', title: ties.get(n.id).join('\n') }, ties.get(n.id).join(' · '));
  const body = h('div', { class: 'lb-top' });
  const count = (n) => litCount(n, style);
  const hint = (n) => `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.all > 1 ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : n.state.blocked ? ', blocked' : ''}${waits.has(n.id) ? `\nWaits on: ${waits.get(n.id).join('; ')}` : ''}${n.at ? '\nA session is at work here' : ''}`;
  const mark = (cls, text, title) => h('span', { class: `lb-mark lb-${cls}`, title }, text);
  const marks = (n) => [
    show.has('you') && n.you > 0 && mark('you', n.all > 1 ? String(n.you) : '', n.all > 1 ? `${n.you} need you` : 'Waits on you'),
    show.has('blocked') && n.blk > 0 && mark('blocked', n.all > 1 ? String(n.blk) : '', n.all > 1 ? `${n.blk} blocked` : 'Blocked'),
    show.has('sessions') && n.at > 0 && mark('at', '', 'A session is at work here'),
    show.has('count') && n.all > 1 && mark('count', String(n.work), `${n.work} open`),
    show.has('type') && mark('word', typeTitle(n.type), 'What kind of thing it is'),
    show.has('status') && mark('word', n.status, 'Its status'),
  ];
  const thing = (n) => {
    const state = `${count(n) ? '' : ' dim'}${n.open ? '' : ' closed'}${n.state.blocked ? ' blocked' : ''}${me && n.state.waits_on.includes(me) ? ' you' : ''}${n === here || n.id === style.here ? ' here' : ''}`;
    if (n.all === 1) return h('a', { class: `lb-leaf${state}`, href: `#/e/${n.id}`, title: hint(n) }, h('span', { class: 'lb-dot' }), h('span', { class: 'lb-name' }, n.title), tied(n), ...marks(n).slice(2));
    const open = n.kids.length > 0 && (opened.get(n.id) ?? (above.has(n.id) || n.depth - base < levels));
    const leaves = n.kids.filter((kid) => kid.all === 1);
    const boxes = n.kids.filter((kid) => kid.all > 1);
    return h(
      'section',
      { class: `lb-box${state}${open ? ' open' : ''}${n.depth % 2 ? ' odd' : ''}` },
      h(
        'header',
        { title: hint(n) },
        n.kids.length > 0 && h('button', { class: 'lb-fold', title: open ? 'Close it' : 'Open it', onclick: () => (opened.set(n.id, !open), draw()) }, open ? '▾' : '▸'),
        h('a', { class: 'lb-name', href: `#/e/${n.id}` }, n.title),
        tied(n),
        ...marks(n),
      ),
      show.has('bar') && h('div', { class: 'lb-bar', title: `${n.you} need you, ${n.blk} blocked, of ${n.all}` }, h('span', { class: 'lb-you', style: `width:${(100 * n.you) / n.all}%` }), h('span', { class: 'lb-blocked', style: `width:${(100 * n.blk) / n.all}%` })),
      open && leaves.length > 0 && h('div', { class: `lb-leaves ${['row', 'chip', 'dot'].includes(style.leaf) ? style.leaf : 'row'}` }, leaves.map(thing)),
      open && boxes.length > 0 && h('div', { class: 'lb-kids' }, boxes.map(thing)),
    );
  };
  // Around one item its neighbours are gathered under the link that ties each to it, said as that item would say it.
  const start = answer.lens.from;
  const said = (lane) => {
    const [kind, inward] = String(lane).split(':');
    const phrase = lane == null ? 'near it' : ((inward ? relations.get(kind)?.inverse : relations.get(kind)?.title) ?? kind);
    return phrase[0].toUpperCase() + phrase.slice(1);
  };
  const draw = () => {
    const loose = start && answer.lens.lanes === 'link' ? root.kids.filter((n) => n.all === 1 && n.id !== start) : [];
    const lanes = new Map();
    for (const n of loose) lanes.set(n.lane ?? null, [...(lanes.get(n.lane ?? null) ?? []), n]);
    body.replaceChildren(
      // The item the page is about is not drawn again as a line of its own.
      ...root.kids.filter((n) => !loose.includes(n) && !(n.id === start && n.all === 1)).map(thing),
      ...[...lanes].map(([lane, things]) => h('section', { class: 'lb-box lane' }, h('header', {}, h('span', { class: 'lb-name' }, said(lane)), h('span', { class: 'lb-mark lb-count' }, String(things.length))), h('div', { class: 'lb-leaves row' }, things.map(thing)))),
    );
  };
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), litSwitch(me, style, keep, draw)), body);
  host.redraw = draw;
  draw();
}

/** The nest: circles in circles, opened by zooming. Reads only what a lens answers with. */
export const LENS_SHAPES = { nest: drawNest, boxes: drawBoxes, grid: drawGrid, time: drawTime };

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
