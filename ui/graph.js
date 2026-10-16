import { api, h } from './base.js';
import { drawGraph, timeline } from './graph-draw.js';
import { menu, relations } from './words.js';

// ---- Graph ---------------------------------------------------------------

// Colour says what kind of thing a node is: one of the seven kinds every
// type extends, or the system's own records. A palette checked for
// colour-blind separation in both themes. Red is kept for "blocked", which is
// also drawn as a ring and named in the tooltip.
export const GROUPS = ['actor', 'aim', 'work', 'question', 'record', 'occurrence', 'place'];
export const groupOf = (kind) => (GROUPS.includes(kind) ? kind : 'system');
export const BLOCKING = ['depends_on', 'waits_on', 'needs', 'holds'];
/** Whether a relation is one of these, or extends one of them. */
export const isOf = (list, type) => list.includes(type) || list.includes(relations.get(type)?.root);
export const SVG = 'http://www.w3.org/2000/svg';
export const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};

// One drawing for every picture of the map: a project's features, what is
// around an item, the whole map. They differ only in where it starts and in
// its filters (which relations, how far out, whether what is finished shows),
// never in how it looks. It is laid out, not simulated, so it looks the same
// every time. Where there is work in sight, across is tokens: each piece of
// work as long as it is expected to take, with what it has used so far, and
// down is the order it happens in: done, under way, to come.
// Where there is none, what a thing belongs to or waits on is to its left
// and what belongs to it or waits on it to its right. Anything can then be
// dragged aside.
export const KINDS = { structure: ['part_of', 'serves', 'lives_in', 'works_at'], blocking: BLOCKING, all: null };
export const KIND_LABELS = [['structure', 'Structure'], ['blocking', 'Blocking'], ['all', 'Everything']];
/** Each drawing's filters and what was dragged in it, by what it is drawn around, kept while the page is open. */
export const graphPrefs = new Map();
export const prefsOf = (key, defaults = {}) => {
  if (!graphPrefs.has(key)) graphPrefs.set(key, { kind: 'all', steps: 1, finished: true, fit: false, moved: new Map(), ...defaults });
  return graphPrefs.get(key);
};

/**
 * The graph around `focus` (or of the whole map without one), with its
 * filters above it. `extras` is what a page knows beyond the graph view: per
 * item (`info`: progress, place in an order, whether it is being worked on)
 * and edges to add (a feature waiting on another through their tasks).
 */
export function graphView({ focus, key, defaults, extras } = {}) {
  // Two drawings around one thing (a project's work, and what else it is linked to) keep their own filters.
  const prefs = prefsOf(key ?? focus ?? '', defaults);
  const host = h('div', { class: 'graph-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const draw = async () => {
    let data;
    try {
      // One step further than is drawn is asked for: what a thing in sight waits on is shown with it.
      data = await api('view', { name: 'graph', params: { focus, depth: focus ? Math.min(prefs.steps + 1, 4) : undefined, relations: 'all', include_closed: true } });
    } catch (err) {
      return host.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    // A filter changed lays it out afresh; how it is sized does not.
    const set = (change, tidy = true) => () => {
      Object.assign(prefs, change);
      if (tidy) prefs.moved.clear();
      draw();
    };
    const pick = (key, options, title) => h('span', { class: 'switch', title }, options.map(([value, label]) => h('button', { class: prefs[key] === value ? 'on' : '', onclick: set({ [key]: value }) }, label)));
    // The scale of tokens is cut to the room there is, so a chart opens whole and is not scrolled across.
    prefs.width = prefs.full ? window.innerWidth - 66 : Math.max(520, (host.clientWidth || (document.querySelector('main')?.clientWidth ?? 1060) - 30) - 50);
    const shaped = shapeGraph(data, focus, prefs, extras);
    // Filling the window, it says what it is a drawing of, since the page's own head is behind it.
    host.classList.toggle('full', Boolean(prefs.full));
    host.replaceChildren(
      h(
        'div',
        { class: 'toolbar fold-bar' },
        prefs.full && h('strong', { class: 'graph-title' }, data.nodes.find((n) => n.id === focus)?.title ?? 'The whole map'),
        !extras?.workOnly && pick('kind', KIND_LABELS, 'Which relations to draw'),
        !extras?.workOnly && focus && pick('steps', [[1, 'Near'], [2, '2 steps'], [3, '3 steps']], 'How far out to draw'),
        h('span', { class: 'grow' }),
        h('button', { title: prefs.full ? 'Back to the page (Esc)' : 'Fill the window with the drawing', onclick: set({ full: !prefs.full }, false) }, prefs.full ? 'Close' : 'Full screen'),
        menu('View', [
          [prefs.finished ? 'Hide what is finished' : 'Show what is finished', set({ finished: !prefs.finished })],
          [prefs.fit ? 'Actual size' : 'Fit to width', set({ fit: !prefs.fit }, false)],
          prefs.moved.size > 0 && !shaped.axis && ['Tidy', set({})],
        ]),
      ),
      shaped.nodes.length > (focus ? 1 : 0) ? drawGraph(shaped, prefs) : h('div', { class: 'empty' }, focus ? 'Nothing is linked to it this way.' : 'Nothing to draw with these filters.'),
    );
  };
  // Esc leaves the full window, while this drawing is the one on the page.
  const leave = (ev) => {
    if (!host.isConnected) return document.removeEventListener('keydown', leave);
    if (ev.key !== 'Escape' || !prefs.full) return;
    prefs.full = false;
    draw();
  };
  document.addEventListener('keydown', leave);
  draw();
  return host;
}

/** Which nodes and edges the filters leave, and where each node goes. */
export function shapeGraph(data, focus, prefs, extras = {}) {
  const BOX = { w: 224, h: 56, col: 292, gap: 12 };
  const info = extras.info ?? new Map();
  // A drawing of work alone (a project's features) leaves out what takes no tokens: people, repositories, notes.
  // Those are the project's other drawing, which leaves out the work.
  const byId = new Map(data.nodes.filter((n) => n.id === focus || ((prefs.finished || n.open) && (!extras.workOnly || n.work) && (!extras.restOnly || !n.work))).map((n) => [n.id, { ...n, ...info.get(n.id) }]));
  const seen = new Set();
  const all = [...data.edges, ...(extras.edges ?? [])].filter((e) => byId.has(e.from) && byId.has(e.to) && !seen.has(e.id) && seen.add(e.id));
  const counts = (e) => !KINDS[prefs.kind] || isOf(KINDS[prefs.kind], e.type);
  const walk = all.filter(counts);

  // How many columns from the start each thing is: to the right when it
  // belongs to or waits on what it was reached from, to the left otherwise.
  const rank = new Map();
  const starts = focus ? [focus] : [...byId.keys()].filter((id) => !walk.some((e) => e.from === id) && walk.some((e) => e.to === id));
  for (const id of starts) rank.set(id, 0);
  for (let d = 0, frontier = starts; frontier.length && (!focus || d < prefs.steps); d++) {
    const at = new Set(frontier);
    const next = [];
    for (const e of walk) {
      for (const [cur, other, dir] of [[e.to, e.from, 1], [e.from, e.to, -1]]) {
        if (!at.has(cur) || rank.has(other)) continue;
        rank.set(other, rank.get(cur) + dir);
        next.push(other);
      }
    }
    frontier = next;
  }
  // What a thing in sight waits on is in sight too, though it is a step further out: a thing marked as blocked shows what by.
  if (focus) for (const e of all) if (isOf(BLOCKING, e.type) && rank.has(e.from) && !rank.has(e.to)) rank.set(e.to, rank.get(e.from) - 1);
  // A project's chart is one level: its features, and its work that is under none of them. A task that is part of a feature is on that feature's page.
  if (extras.workOnly) for (const e of walk) if (isOf(['part_of'], e.type) && e.to !== focus && rank.has(e.to) && rank.has(e.from)) rank.delete(e.from);
  const nodes = [...rank.keys()].map((id) => byId.get(id));
  // What waits on what is drawn whatever the filter, among the things in sight.
  const edges = all.filter((e) => rank.has(e.from) && rank.has(e.to) && (counts(e) || isOf(BLOCKING, e.type)));
  // What waits comes after what it waits on. A loop of waiting stops going round.
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const e of edges) {
      if (!isOf(BLOCKING, e.type) || e.from === focus || rank.get(e.from) > rank.get(e.to)) continue;
      rank.set(e.from, rank.get(e.to) + 1);
      moved = true;
    }
    if (!moved) break;
  }

  // Where there is work in sight, across is tokens, and the work is laid along it.
  // Only around work, though: around a repository or a person it is their neighbourhood that is wanted, not a scale.
  if (nodes.filter((n) => n.work).length > 1 && (!focus || byId.get(focus).work)) {
    const { axis, drawn } = timeline(nodes, edges, byId, focus, prefs);
    return { nodes, edges: drawn, byId, focus, axis };
  }

  // Otherwise each column sits as near as it can to what it is linked to in the columns already placed, nearest the start first.
  const near = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    near.get(e.from).push(byId.get(e.to));
    near.get(e.to).push(byId.get(e.from));
  }
  const cols = new Map();
  for (const n of nodes) cols.set(rank.get(n.id), [...(cols.get(rank.get(n.id)) ?? []), n]);
  const wanted = (n) => {
    const placed = near.get(n.id).filter((p) => p.y !== undefined);
    return placed.length ? placed.reduce((sum, p) => sum + p.y, 0) / placed.length : undefined;
  };
  for (const r of [...cols.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)) {
    const want = new Map(cols.get(r).map((n) => [n, wanted(n)]));
    const ordered = [...cols.get(r)].sort((a, b) => (want.get(a) ?? Infinity) - (want.get(b) ?? Infinity) || (a.place ?? 1e9) - (b.place ?? 1e9) || a.title.localeCompare(b.title));
    let y = 0;
    for (const n of ordered) {
      n.y = Math.max(y, want.get(n) ?? y);
      y = n.y + BOX.h + BOX.gap;
    }
  }
  // The start sits level with the middle of what is around it, but never so far down that it opens out of sight.
  const centre = focus && cols.get(0).length === 1 && byId.get(focus);
  if (centre && near.get(focus).length) centre.y = Math.min(near.get(focus).reduce((sum, p) => sum + p.y, 0) / near.get(focus).length, 240);
  const left = Math.min(0, ...cols.keys());
  const top = Math.min(0, ...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x = (rank.get(n.id) - left) * BOX.col;
    n.y -= top;
    n.w = BOX.w;
    n.h = BOX.h;
    const dragged = prefs.moved.get(n.id);
    if (dragged) Object.assign(n, dragged);
  }
  return { nodes, edges, byId, focus };
}


/**
 * Where there is work in sight, across is tokens. Work is laid end to end in
 * the order it is to be done (its place on the roadmap, and after what it
 * waits on), each thing as long as it is expected to take, so where a thing
 * ends is what will have been spent by then; a thing spans what is part of
 * it. What has no estimate is given a middling length and drawn as a guess.
 * What is not work (a person, a repository, a note) has no place on the
 * scale and sits under it.
 */
