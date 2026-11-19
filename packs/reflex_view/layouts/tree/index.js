// The reflex tree, after the hero figure of Sihan Xu's essay on a harness that grows (sihanxu.me/harnesstree): the
// instructions and reflex nodes a view finds, as one tree growing from its root (./tree.js), placed radially
// (./radial.js). Played (./film.js, ./play.js): it grows from the root alone, each node coming in where it stands,
// in the order its item was made, with an amber spark where the model writes it; blue lights run from the root out
// to a node as it is said, over real dates. What happened comes in at one seam (./story.js): misses, sayings with
// their verdicts, tiers and standing, schematic until the reflex pack tells them. The counts
// and Replay stand over the picture. Opened again, it stands grown, and what is new since is born where it stands;
// under reduced motion it stands grown and still. Every length, time and colour is the style's (reflex_* in its
// sizes, numbers and colors): the view's preset names them all.

import { placeOfBough, treeOf } from './tree.js';
import { radial } from './radial.js';
import { rulesOf, storyOf, toldFrom, weekTo } from './story.js';
import { filmOf } from './film.js';
import { marksOf, tipOf } from './draw.js';
import { barOf, cssOf, packHues } from './look.js';
import { player } from './play.js';
import { nameTransform, namesShown } from './names.js';
import { at, m } from './marks.js';
import { hiddenOf, legendCss, legendOf, shownBy } from './legend.js';

/** What each view drew last, by its query: opened again, it stands grown. */
const drawn = new Map();
const SPEEDS = [0.5, 1, 2];
/** The view this drawing ships as (reflex_view's preset): a legend's change goes to its owner's version. */
const SHIPPED = 'reflex_view.tree';

/**
 * What the pack answers of each node (style.sends.said: the reflex_view pack's said_counts), reflex_said_batch ids at
 * a time, waited for at most reflex_said_wait ms: each { id, said, for, ... }. None where the view sends nothing.
 */
async function recordsOf(ids, style, tools, n, gesture = 'said') {
  const ask = typeof style.sends?.[gesture] === 'string' && typeof tools.act === 'function' ? style.sends[gesture] : null;
  if (!ask || !ids.length) return null;
  const batch = Math.max(1, n('reflex_said_batch'));
  const asked = Promise.all(Array.from({ length: Math.ceil(ids.length / batch) }, (_, i) => tools.act(ask, { ids: ids.slice(i * batch, (i + 1) * batch), ...(gesture === 'story' && { days: n('reflex_window_days') }) })))
    .then((came) => {
      const answers = came.filter((c) => c && !c.error && c.answer).map((c) => c.answer);
      if (gesture === 'said') return answers.flatMap((a) => (Array.isArray(a) ? a : []));
      // The story asked in batches: its nodes and sayings from each, its window and misses once.
      const first = answers.find((a) => a && Array.isArray(a.nodes));
      return first ? { ...first, nodes: answers.flatMap((a) => a.nodes ?? []), said: answers.flatMap((a) => a.said ?? []) } : null;
    })
    .catch(() => null);
  return Promise.race([asked, new Promise((r) => setTimeout(() => r(null), n('reflex_said_wait')))]);
}

/** What the pack answers of the window (style.sends: its views misses or rules), over reflex_window_days; null where none. */
async function missesOf(style, tools, n, gesture = 'misses') {
  const ask = typeof style.sends?.[gesture] === 'string' && typeof tools.act === 'function' ? style.sends[gesture] : null;
  if (!ask) return null;
  const asked = tools.act(ask, { days: n('reflex_window_days') }).then((c) => (c && !c.error && Array.isArray(c.answer) ? c.answer : null)).catch(() => null);
  return Promise.race([asked, new Promise((r) => setTimeout(() => r(null), n('reflex_said_wait')))]);
}

/**
 * A click on a legend entry: the view's pack is asked to turn it off or on (sends.legend), as the person. The view
 * changes, and the picture is drawn again from it; meanwhile the entry looks as it will.
 */
function legendClick(event, hidden, style, tools, answer, again) {
  const key = typeof event.key === 'string' ? event.key : '';
  if (event.name !== 'click' || !key.startsWith('lg:') || typeof style.sends?.legend !== 'string' || typeof tools.act !== 'function') return [];
  const entry = key.slice('lg:'.length), on = hidden.has(entry);
  // The view changed is the owner's version of the shipped one (a drawing is not told its view's id); where none is
  // kept yet, the pack makes it from the style and query drawn here.
  const { hidden: _, ...drawnStyle } = style;
  const query = { filter: { find: answer?.lens?.find ?? [], only: answer?.lens?.only ?? [], not: answer?.lens?.not ?? [] }, ...(answer?.lens?.walk && { walk: answer.lens.walk }), ...(answer?.lens?.limit && { limit: answer.lens.limit }) };
  const next = on ? [...hidden].filter((e) => e !== entry) : [...hidden, entry];
  tools.act(style.sends.legend, { view: SHIPPED, entry, on, style: drawnStyle, ...query }).then((came) => !came?.error && again?.(next)).catch(() => {});
  return [{ key, toggle: { 'rt-off': !on } }];
}

/**
 * The tree, drawn again in place when a legend entry turns: the pack has changed the view, and the picture now drawn
 * is the same view's, so it is built again from it (grown, as one already seen) and its marks take the old ones' place.
 */
export async function picture(input, tools) {
  let now = null;
  const again = async (hidden) => {
    const next = await drawn1({ ...input, style: { ...input.style, hidden } }, tools, again);
    now?.end?.();
    now = next;
    const all = next.scene.svg?.[2];
    tools.patch([...(all ? [{ key: 'rt-all', mark: all }] : []), ...(next.scene.aside ? [{ key: 'rt-legend', mark: next.scene.aside }] : []), ...(next.scene.before ? [{ key: 'rt-bar', mark: next.scene.before }] : [])]);
  };
  now = await drawn1(input, tools, again);
  return { ...now, on: (event) => now.on?.(event) ?? [], viewport: (view) => now.viewport?.(view) ?? [], restyle: () => [], end: () => now.end?.() };
}

async function drawn1({ answer, style, reduced, width, height }, tools, again) {
  const missing = [];
  const read = (group) => (name) => {
    const v = style[group]?.[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) missing.push(name);
    return Number(v) || 0;
  };
  const z = read('sizes'), n = read('numbers');
  // Where each node is said shapes its boughs, and how often lights it: both are asked of the pack before it is laid out.
  const first = treeOf(answer);
  if (!first) return { scene: { message: 'This view holds no instruction or reflex node yet.' } };
  const ids = first.written.map((node) => node.id);
  const [records, story0, misses, ruled] = await Promise.all([recordsOf(ids, style, tools, n), recordsOf(ids, style, tools, n, 'story'), missesOf(style, tools, n), missesOf(style, tools, n, 'rules')]);
  const rules = rulesOf(ruled);
  // The pack's own story where the view sends one; else made from its counts and misses where both came, each
  // node's sayings with their days; else schematic.
  const now = Date.now();
  const told = story0 ?? (misses && records?.some((r) => Array.isArray(r.per_run)) ? toldFrom(records, misses, now, n('reflex_window_days'), rules) : null);
  const counts = new Map((records ?? []).filter((r) => r && Number.isFinite(Number(r.said))).map((r) => [r.id, Number(r.said)]));
  const tiers = new Map((records ?? []).filter((r) => r && typeof r.tier === 'string').map((r) => [r.id, r.tier]));
  const story = storyOf(answer, told, records ? counts : null, n, now, tiers);
  const placeOf = new Map([...(records ?? []).filter((r) => r && r.for !== undefined).map((r) => [r.id, r.for]), ...[...story.nodes].filter(([, x]) => x.for !== undefined).map(([id, x]) => [id, x.for])]);
  if (!story.rules?.length) story.rules = rules;
  // Core's and the packs' presets stand with the rest; each rule under the place it guards, where saying and enforcing meet.
  const presets = [
    ...[...story.nodes].filter(([, x]) => x.tier === 'core' || x.tier === 'pack').map(([id, x]) => ({ id, ...x })),
    ...story.rules.map((r) => ({ id: r.id, title: r.title, for: [r.where], kind: 'rule' })),
  ];
  // The legend filters (./legend.js): what its entries turn off leaves the tree, which fits itself again; a bough with
  // nothing left under it goes with it. Every node the view holds is counted, filter or no.
  const hidden = hiddenOf(style);
  const infoOf = (id, rule) => {
    const r = rule ? story.rules.find((x) => x.id === id) : null, x = story.nodes.get(id);
    return { id, rule: Boolean(rule), pack: r ? r.pack : x?.pack ?? x?.tier ?? 'owner', tier: r ? (r.pack === 'core' ? 'core' : 'pack') : x?.tier ?? 'owner', status: r ? 'current' : x?.status ?? 'current' };
  };
  const everyNode = [...first.written.map((node) => infoOf(node.id, false)), ...presets.map((p) => infoOf(p.id, p.kind === 'rule'))];
  const keep = new Set(everyNode.filter(shownBy(hidden)).map((x) => x.id)), counted = new Set(everyNode.map((x) => x.id));
  const shownAnswer = { ...answer, items: (answer.items ?? []).filter((i) => !counted.has(i.id) || keep.has(i.id)) };
  const tree = treeOf(shownAnswer, (item) => item.fields?.for ?? placeOf.get(item.id), n, presets.filter((p) => keep.has(p.id)));
  // Each pack the view holds its hue, core first; and every event of the window, counted for the legend.
  const packs = [...new Set(everyNode.map((x) => x.pack))].sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : 0));
  const hues = packHues(style, packs);
  const happened = { miss: story.misses.length, held: story.said.filter((x) => x.verdict !== 'failed' && x.verdict !== 'came_back').length, failed: story.said.filter((x) => x.verdict === 'failed' || x.verdict === 'came_back').length, fired: story.rules.reduce((sum, r) => sum + r.fired.length, 0) };
  const toggles = typeof style.sends?.legend === 'string' && typeof tools.act === 'function';
  const legend = legendOf({ nodes: everyNode, events: happened, hidden, hues, toggles, schematic: story.schematic });
  if (!tree) return { scene: { svg: m('svg', { class: 'rt', width: z('reflex_margin'), height: z('reflex_margin') }, m('g', { key: 'rt-all' })), css: cssOf(style, z, n, hues) + legendCss, aside: legend, size: { width: z('reflex_margin'), height: z('reflex_margin') } }, on: (event) => legendClick(event, hidden, style, tools, answer, again) };
  // How often each held, for which names show first and the tips.
  const held = new Map();
  for (const one of story.said) if (one.verdict === 'held') held.set(one.id, (held.get(one.id) ?? 0) + 1);
  // Names are measured as the page writes them; without a measure (a test), at about half their size a letter.
  const measure = tools.measure ?? ((text, px) => text.length * px * 0.55);
  // The room it is shown in: the pane at the scale the page fits it (reflex_fit_scale, at or over the page's least),
  // less the share the key and bars take (reflex_fit_room).
  const fits = width > 0 && height > 0 ? { width: (width * n('reflex_fit_room')) / n('reflex_fit_scale'), height: (height * n('reflex_fit_room')) / n('reflex_fit_scale') } : null;
  const placed = radial(tree, z, n, (text, px) => measure(text, px), width > 0 && height > 0 ? width / height : 1, fits);
  const film = filmOf(tree, story, n);
  film.events = film.events.filter((e) => !hidden.has(`event:${e.kind}`));
  const name = JSON.stringify([answer.lens?.find, answer.lens?.only, answer.lens?.not, answer.lens?.from]);
  const before = drawn.get(name);
  drawn.set(name, new Set(tree.born.map((node) => node.id)));
  const grown = reduced || before !== undefined;
  const fresh = before && !reduced ? tree.born.filter((node) => !before.has(node.id)) : [];
  const shown = (node) => grown && !fresh.includes(node);
  // Which names show, at full size until the page says its zoom: chosen again as the zoom changes.
  let scaleAt = 1, named = namesShown(tree, placed, held, z, n, scaleAt);
  // Grown, the gaps stand already: each place a miss sparked on and grew nothing from.
  const gapped = new Set(grown ? film.events.filter((e) => e.kind === 'miss' && !e.grew).map((e) => e.node.id) : []);
  // A bough whose place can be said takes a new trial node there, where the view sends `add` (the pack's action).
  const adding = typeof style.sends?.add === 'string' && typeof tools.act === 'function';
  const addsAt = (node) => (adding && !node.item && !node.preset && node.parent ? placeOfBough(node.id) : null);
  const { svg, sparks, lights } = marksOf(tree, placed, z, n, shown, named.shown, story, gapped, addsAt);
  const css = cssOf(style, z, n, hues) + legendCss;
  if (missing.length) return { scene: { message: `This view's style names no ${[...new Set(missing)].slice(0, 2).join(', ')}: draw it with the Reflex tree view, whose preset names them.` } };
  const speed = { now: 1 };
  const from = grown ? film.end : 0;
  const play = player({ tree, placed, film, story, z, n, pools: { sparks, lights }, from, fresh, speed });
  const start = grown ? story.to : story.from;
  const bar = barOf({ ...weekTo(story, start), day: new Date(start).toISOString().split('T')[0], schematic: story.schematic, speed: speed.now, speeds: reduced ? [] : SPEEDS });
  let alive = !reduced, last = null, frames = 0;
  const loop = async () => {
    while (alive) {
      await tools.frame();
      if (!alive) return;
      // A scene with a surface is drawn afresh each time, never mounted from a picture kept still: a played tree must
      // run. Its surface is asked for once the page has drawn a frame of this scene (the second): asked sooner, the
      // page has no surface for it yet and answers none, the worker keeps that answer, and the picture this one
      // replaces stays laid over it, still, until a first frame is shown that never comes. Its canvas takes a context
      // first: one with none has no image to show.
      if (++frames === 2) tools.surface?.().then((s) => s && (s.canvas.getContext('2d'), s.show())).catch(() => {});
      const now = performance.now(), dt = last === null ? 0 : Math.min(n('reflex_frame_most'), (now - last) / 1000);
      last = now;
      const out = play.step(dt);
      if (out.length) tools.patch(out);
    }
  };
  if (alive) loop().catch(() => (alive = false));
  const byKey = (key) => tree.nodes.get(key.slice(2));
  return {
    scene: { svg, css, aside: legend, before: bar, size: { width: placed.width, height: placed.height }, ...(!reduced && { surface: { key: 'rt-surface' } }) },
    on(event) {
      const key = typeof event.key === 'string' ? event.key : '';
      if (key.startsWith('n:')) {
        const node = byKey(key);
        const place = node && addsAt(node);
        if (place && event.name === 'click') {
          tools.act(style.sends.add, { for: place }, { asks: [{ field: 'title', title: `A trial node at ${place}`, input: { placeholder: 'What to say there, in a few words' }, action: 'Add' }] }).catch(() => {});
          return [];
        }
        if (!node?.item) return [];
        if (event.name === 'click') return (tools.open(node.item.id), []);
        if (event.name === 'enter') return [{ tip: { key, mark: tipOf(node, held.get(node.id) ?? 0, n('reflex_tip_most')) } }];
        if (event.name === 'leave') return [{ tip: null }];
        return [];
      }
      if (key.startsWith('lg:')) return legendClick(event, hidden, style, tools, answer, again);
      if (event.name !== 'click' || reduced) return [];
      if (key === 'rt:replay') return play.replay();
      if (key.startsWith('rt:speed:')) {
        speed.now = Number(key.slice('rt:speed:'.length)) || 1;
        return SPEEDS.map((s) => ({ key: `rt:speed:${s}`, toggle: { on: s === speed.now } }));
      }
      return [];
    },
    restyle: () => [],
    // Names keep one size on screen: at a new zoom (by more than reflex_name_rescale), each is laid at its size there
    // and which show is chosen again, so zooming in shows more.
    viewport(view) {
      const f = 1 / Math.max(n('reflex_name_zoom_least'), Number(view?.scale) || 1);
      if (Math.abs(Math.log(f / scaleAt)) < Math.log(n('reflex_name_rescale'))) return [];
      scaleAt = f;
      named = namesShown(tree, placed, held, z, n, f);
      return [...placed.labels.values()].flatMap((l) => [{ key: `nm:${l.id}`, set: { transform: nameTransform(l, f, at) } }, { key: `nm:${l.id}`, toggle: { 'rt-quiet': !named.shown.has(l.id) } }]);
    },
    end() {
      alive = false;
    },
  };
}
