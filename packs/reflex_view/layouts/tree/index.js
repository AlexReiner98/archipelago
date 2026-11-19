// The reflex tree, after the hero figure of Sihan Xu's essay on a harness that grows (sihanxu.me/harnesstree): the
// instructions and reflex nodes a view finds, as one tree growing from its root (./tree.js), placed radially
// (./radial.js). Played (./film.js, ./play.js): it grows from the root alone, each node coming in where it stands,
// in the order its item was made, with an amber spark where the model writes it; blue lights run from the root out
// to a node as it is said, more often the more of the tree there is, so the amber thins and the blue takes over. How
// often each node is said comes in at one seam (./said.js), schematic until the reflex pack counts it. The counts
// and Replay stand over the picture. Opened again, it stands grown, and what is new since is born where it stands;
// under reduced motion it stands grown and still. Every length, time and colour is the style's (reflex_* in its
// sizes, numbers and colors): the view's preset names them all.

import { treeOf } from './tree.js';
import { radial } from './radial.js';
import { countedFrom, sayingsOf } from './said.js';
import { filmOf } from './film.js';
import { marksOf, tipOf } from './draw.js';
import { barOf, cssOf, keyOf } from './look.js';
import { player } from './play.js';
import { nameTransform, namesShown } from './names.js';
import { at } from './marks.js';

/** What each view drew last, by its query: opened again, it stands grown. */
const drawn = new Map();
const SPEEDS = [0.5, 1, 2];

/**
 * What the pack answers of each node (style.sends.said: the reflex_view pack's said_counts), reflex_said_batch ids at
 * a time, waited for at most reflex_said_wait ms: each { id, said, for, ... }. None where the view sends nothing.
 */
async function recordsOf(ids, style, tools, n) {
  const ask = typeof style.sends?.said === 'string' && typeof tools.act === 'function' ? style.sends.said : null;
  if (!ask || !ids.length) return null;
  const batch = Math.max(1, n('reflex_said_batch'));
  const asked = Promise.all(Array.from({ length: Math.ceil(ids.length / batch) }, (_, i) => tools.act(ask, { ids: ids.slice(i * batch, (i + 1) * batch) })))
    .then((came) => came.flatMap((c) => (c && !c.error && Array.isArray(c.answer) ? c.answer : [])))
    .catch(() => null);
  return Promise.race([asked, new Promise((r) => setTimeout(() => r(null), n('reflex_said_wait')))]);
}

export async function picture({ answer, style, reduced, width, height }, tools) {
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
  const records = await recordsOf(first.written.map((node) => node.id), style, tools, n);
  const placeOf = new Map((records ?? []).filter((r) => r && r.for !== undefined).map((r) => [r.id, r.for]));
  const tree = treeOf(answer, (item) => item.fields?.for ?? placeOf.get(item.id), n);
  // Names are measured as the page writes them; without a measure (a test), at about half their size a letter.
  const measure = tools.measure ?? ((text, px) => text.length * px * 0.55);
  // The room it is shown in: the pane at the scale the page fits it (reflex_fit_scale, at or over the page's least),
  // less the share the key and bars take (reflex_fit_room).
  const fits = width > 0 && height > 0 ? { width: (width * n('reflex_fit_room')) / n('reflex_fit_scale'), height: (height * n('reflex_fit_room')) / n('reflex_fit_scale') } : null;
  const placed = radial(tree, z, n, (text, px) => measure(text, px), width > 0 && height > 0 ? width / height : 1, fits);
  const said = sayingsOf(tree, n);
  if (records) countedFrom(said, records);
  const film = filmOf(tree, said, n);
  const name = JSON.stringify([answer.lens?.find, answer.lens?.only, answer.lens?.not, answer.lens?.from]);
  const before = drawn.get(name);
  drawn.set(name, new Set(tree.born.map((node) => node.id)));
  const grown = reduced || before !== undefined;
  const fresh = before && !reduced ? tree.born.filter((node) => !before.has(node.id)) : [];
  const shown = (node) => grown && !fresh.includes(node);
  // Which names show, at full size until the page says its zoom: chosen again as the zoom changes.
  let scaleAt = 1, named = namesShown(tree, placed, said.counts, z, n, scaleAt);
  const { svg, sparks, lights } = marksOf(tree, placed, z, n, shown, named.shown);
  const css = cssOf(style, z, n);
  if (missing.length) return { scene: { message: `This view's style names no ${[...new Set(missing)].slice(0, 2).join(', ')}: draw it with the Reflex tree view, whose preset names them.` } };
  const speed = { now: 1 };
  const from = grown ? film.end : 0;
  const play = player({ tree, placed, film, said, z, n, pools: { sparks, lights }, from, fresh, speed });
  const counts = grown ? { said: said.total, written: tree.written.length } : { said: 0, written: 0 };
  const bar = barOf({ ...counts, schematic: said.schematic, speed: speed.now, speeds: reduced ? [] : SPEEDS });
  let alive = !reduced, last = null;
  const loop = async () => {
    while (alive) {
      await tools.frame();
      if (!alive) return;
      const now = performance.now(), dt = last === null ? 0 : Math.min(n('reflex_frame_most'), (now - last) / 1000);
      last = now;
      const out = play.step(dt);
      if (out.length) tools.patch(out);
    }
  };
  if (alive) loop().catch(() => (alive = false));
  // A scene with a surface is drawn afresh each time, never mounted from a picture kept still: a played tree must
  // run. Its first frame is shown at once (nothing on it yet), so the page knows the picture has drawn.
  if (!reduced) tools.surface?.().then((s) => s?.show()).catch(() => {});
  const byKey = (key) => tree.nodes.get(key.slice(2));
  return {
    scene: { svg, css, key: keyOf(z, said.schematic), before: bar, size: { width: placed.width, height: placed.height }, ...(!reduced && { surface: { key: 'rt-surface' } }) },
    on(event) {
      const key = typeof event.key === 'string' ? event.key : '';
      if (key.startsWith('n:')) {
        const node = byKey(key);
        if (!node?.item) return [];
        if (event.name === 'click') return (tools.open(node.item.id), []);
        if (event.name === 'enter') return [{ tip: { key, mark: tipOf(node, said.counts.get(node.id), n('reflex_tip_most')) } }];
        if (event.name === 'leave') return [{ tip: null }];
        return [];
      }
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
      named = namesShown(tree, placed, said.counts, z, n, f);
      return [...placed.labels.values()].flatMap((l) => [{ key: `nm:${l.id}`, set: { transform: nameTransform(l, f, at) } }, { key: `nm:${l.id}`, toggle: { 'rt-quiet': !named.shown.has(l.id) } }]);
    },
    end() {
      alive = false;
    },
  };
}
