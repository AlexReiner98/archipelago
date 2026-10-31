// How the architecture drawing shows a story's step (story.js, played by play.js): what a step takes away goes first,
// marked where it stands and then faded, while nothing else moves; then the rest move to where they go and what is
// new comes in, in the accent for a while, its wires drawn in; a part's outline moves into a new look's, and a plan's
// bars into a board's cards. Every time is the style's (numbers, arch_story_*).

import { m } from './marks.js';

/** The stage a story is played on: `apply(k, dur)` shows step k, `away(k)` says whether it takes something away first. */
export function moves({ style, shape, t, send, later }) {
  const { frames, partAt, placeAt, wireAt, wireD, saysAt, keyOf, view, heads, pathOf, squareMorph, shift, looks, keyLooks, keyLook, family, everyTask, taskAt, boardMark } = shape;
  let cur = -1;
  const shown = new Map(); // what each wire's route is now

  /** Show step k: over `dur` milliseconds, or at once. */
  const apply = (k, dur) => {
    const was = cur >= 0 ? frames[cur] : null, f = frames[k];
    const goneParts = was ? [...was.parts.keys()].filter((id) => !f.parts.has(id)) : [];
    const goneWires = was ? [...was.wires.keys()].filter((key) => !f.wires.has(key)) : [];
    if (dur && (goneParts.length || goneWires.length)) {
      // First what goes: marked where it stands, then faded there, while nothing else moves. A wire's words go with it.
      const said = goneWires.filter((key) => was.says.has(key)).map((key) => `s:${keyOf(key)}`);
      send([...goneParts.map((id) => ({ key: `p:${id}`, toggle: { 'sp-gone': true, 'sp-new': false } })), ...goneWires.flatMap((key) => [`w:${keyOf(key)}`, `h:${keyOf(key)}`].map((w) => ({ key: w, toggle: { 'sp-gone': true, 'sp-new': false } })))]);
      later(t('gone_hold'), () => send([...goneParts.map((id) => ({ key: `p:${id}`, set: { opacity: 0 }, over: t('gone_fade') })), ...[...goneWires.flatMap((key) => [`w:${keyOf(key)}`, `h:${keyOf(key)}`]), ...said].map((w) => ({ key: w, set: { opacity: 0 }, over: t('gone_fade') }))]));
      later(t('gone_hold') + t('gone_fade'), () => move(k, dur));
      return;
    }
    move(k, dur);
  };
  const away = (k) => k > 0 && ([...frames[k - 1].parts.keys()].some((id) => !frames[k].parts.has(id)) || [...frames[k - 1].wires.keys()].some((key) => !frames[k].wires.has(key)));

  const move = (k, dur) => {
    const was = cur >= 0 ? frames[cur] : null, f = frames[k];
    const list = [], fresh = [], flags = [];
    const over = dur ? { over: dur } : {};
    // The look a part is drawn in: its outline moves from one to the other.
    const inLook = Object.fromEntries(looks.map((l) => [`sp-${l}`, family(f.look).includes(l)]));
    for (const [id, n] of f.parts) {
      const at = partAt(n, f), key = `p:${id}`, there = was?.parts.has(id);
      if (there && dur) list.push({ key: `${key}:r`, set: { d: at.s.d }, ...over }, { key: `${key}:d`, set: { cx: at.d.cx, cy: at.d.cy }, ...over }, { key: `${key}:t`, set: at.t, ...over }, { key: `${key}:f`, set: at.f, ...over });
      else list.push({ key: `${key}:r`, set: { d: at.s.d } }, { key: `${key}:d`, set: { cx: at.d.cx, cy: at.d.cy } }, { key: `${key}:t`, set: at.t }, { key: `${key}:f`, set: at.f });
      list.push({ key: `${key}:r`, set: { class: at.s.class } }, { key: `${key}:d`, set: { class: at.d.class } }, { key: `${key}:t`, text: at.text }, { key: `${key}:n`, text: at.title });
      // A flag is put up once its part has grown to hold it, and taken down at once.
      (dur && at.flag ? flags : list).push({ key: `${key}:f`, text: at.flag });
      list.push({ key, toggle: { 'sp-off': false, 'sp-gone': false, 'sp-flagged': Boolean(at.flag), ...inLook }, set: { opacity: 1 }, ...over });
      if (!there && dur && was) fresh.push(key);
    }
    for (const [id] of was?.parts ?? []) if (!f.parts.has(id)) list.push({ key: `p:${id}`, toggle: { 'sp-off': true, 'sp-gone': false, 'sp-new': false }, set: { opacity: 0 } });
    for (const [id, b] of f.boxes) {
      const at = placeAt(b, f), there = was?.boxes.has(id), o = there && dur ? over : {};
      list.push({ key: `b:${id}:box`, set: at.box, ...o }, { key: `b:${id}:n`, set: at.n, ...o }, { key: `b:${id}:d`, set: at.d, ...o }, { key: `b:${id}:t`, set: at.t, ...o }, { key: `b:${id}:f`, set: { x: at.box.x + at.box.width - shape.z('text_after'), y: at.t.y }, ...o });
      list.push({ key: `b:${id}:t`, text: at.text }, { key: `b:${id}:f`, text: at.flag });
      for (const part of [`b:${id}:box`, `b:${id}`]) list.push({ key: part, toggle: { 'sp-off': false, 'sp-flagged': Boolean(at.flag) }, set: { opacity: 1 }, ...over });
    }
    for (const [id] of was?.boxes ?? []) if (!f.boxes.has(id)) for (const part of [`b:${id}:box`, `b:${id}`]) list.push({ key: part, toggle: { 'sp-off': true }, set: { opacity: 0 }, ...over });
    // Wires: one that stays keeps its corners square as it moves (a route keeps its curve); a new one, or one drawn
    // again in a new look, is drawn in once its ends have come to rest.
    for (const [key, c] of f.wires) {
      const pts = wireAt(c), w = `w:${keyOf(key)}`, hd = `h:${keyOf(key)}`, there = was?.wires.has(key) && shown.has(key) && Boolean(was.wires.get(key).curve) === Boolean(c.curve);
      if (there && dur && c.curve) list.push({ key: w, set: { d: wireD(c) }, ...over }, { key: hd, set: { d: heads(pts, c) }, ...over });
      else if (there && dur) {
        const [A, B] = squareMorph(shown.get(key), pts);
        list.push({ key: w, set: { d: pathOf(A) } }, { key: w, set: { d: pathOf(B) }, ...over }, { key: hd, set: { d: heads(pts, c) }, ...over });
      } else if (dur && was) {
        list.push({ key: w, set: { d: wireD(c), 'stroke-dashoffset': 1, opacity: 0 } }, { key: hd, set: { d: heads(pts, c), opacity: 0 } });
        later(dur * 0.9, () => send([{ key: w, toggle: { 'sp-off': false, 'sp-gone': false, 'sp-new': true }, set: { opacity: 1 } }, { key: w, set: { 'stroke-dashoffset': 0 }, over: t('draw') }, { key: hd, toggle: { 'sp-off': false, 'sp-gone': false, 'sp-new': true }, set: { opacity: 1 }, over: t('draw') }]));
        fresh.push(w, hd);
      } else list.push({ key: w, set: { d: wireD(c), 'stroke-dashoffset': 0, opacity: 1 }, toggle: { 'sp-off': false, 'sp-gone': false } }, { key: hd, set: { d: heads(pts, c), opacity: 1 }, toggle: { 'sp-off': false, 'sp-gone': false } });
      shown.set(key, pts);
    }
    for (const [key] of was?.wires ?? []) if (!f.wires.has(key)) (shown.delete(key), list.push(...[`w:${keyOf(key)}`, `h:${keyOf(key)}`].map((w) => ({ key: w, toggle: { 'sp-off': true, 'sp-gone': false, 'sp-new': false }, set: { opacity: 0 } }))));
    // What a wire carries, on it: moved with it, or shown once a new wire is drawn in. What the step lights, lit.
    for (const [key] of f.wires) {
      const s = `s:${keyOf(key)}`, at = saysAt(key, f), lit = f.lit.has(key);
      list.push(...[`w:${keyOf(key)}`, `h:${keyOf(key)}`].map((w) => ({ key: w, toggle: { 'sp-lit': lit } })));
      if (!at) {
        if (frames.some((g) => g.says.has(key))) list.push({ key: s, toggle: { 'sp-off': true }, set: { opacity: 0 } });
        continue;
      }
      const moves = Boolean(dur && was?.says.has(key) && was.look === f.look);
      list.push({ key: `${s}:r`, set: at.r, ...(moves ? over : {}) }, { key: `${s}:t`, set: at.t, ...(moves ? over : {}) }, { key: `${s}:t`, text: at.text }, { key: s, toggle: { 'sp-off': false, 'sp-lit': lit } });
      if (moves || !dur || !was) list.push({ key: s, set: { opacity: 1 } });
      else (list.push({ key: s, set: { opacity: 0 } }), later(dur, () => send([{ key: s, set: { opacity: 1 }, over: t('draw') }])));
    }
    for (const [key] of was?.says ?? []) if (!f.says.has(key) && !f.wires.has(key)) list.push({ key: `s:${keyOf(key)}`, toggle: { 'sp-off': true }, set: { opacity: 0 } });
    // The work a plan or a board draws: a bar moves into a card, a new one comes in, one that goes fades.
    for (const id of everyTask.keys()) {
      const at = taskAt(id, f), key = `t:${id}`, there = Boolean(was && taskAt(id, was));
      if (!at) {
        list.push({ key, toggle: { 'sp-off': true }, set: { opacity: 0 }, ...over });
        continue;
      }
      const o = there && dur ? over : {};
      list.push({ key: `${key}:r`, set: { d: at.d }, ...o }, { key: `${key}:r`, set: { class: at.cls } }, { key: `${key}:t`, set: at.t, ...o }, { key: `${key}:t`, text: at.text }, { key, toggle: { 'sp-off': false }, set: { opacity: 1 }, ...over });
    }
    // A plan's lines and a board's columns, drawn again once all has come to rest.
    if (dur) (list.push({ key: 'board', mark: m('g', { key: 'board' }) }), later(dur, () => send([{ key: 'board', mark: boardMark(f) }])));
    else list.push({ key: 'board', mark: boardMark(f) });
    // Where a wire passes under another, it is broken: drawn again once all has come to rest.
    const breaks = m('g', { key: 'breaks', class: 'sp-breaks' }, f.g.breaks.map(([bx, by]) => m('g', { class: 'ar-break' }, m('rect', { x: bx + shift - 3, y: by - 8, width: 6, height: 16 }), m('path', { d: `M${bx + shift - 6} ${by}H${bx + shift + 6}` }))));
    if (dur) (list.push({ key: 'breaks', mark: m('g', { key: 'breaks' }) }), later(dur, () => send([{ key: 'breaks', mark: breaks }])));
    else list.push({ key: 'breaks', mark: breaks });
    // A published picture is framed as each step is; the key is its look's.
    if (style.still) list.push({ key: 'svg', set: { viewBox: view(f.g) }, ...over });
    list.push(...[null, ...keyLooks].map((l) => ({ key: `key:${l ?? ''}`, toggle: { 'sp-hide': (keyLook(f.look) ?? null) !== l } })));
    // What a step brings is in the accent a while.
    if (fresh.length) (list.push(...fresh.map((key) => ({ key, toggle: { 'sp-new': true } }))), later(t('new_for'), () => send(fresh.map((key) => ({ key, toggle: { 'sp-new': false } })))));
    send(list);
    if (flags.length) later(dur, () => send(flags));
    // Islands in 3D, where the look is theirs (deep.js); the flat picture again where it is not.
    shape.deep?.go(f, dur);
    cur = k;
  };

  return { apply, away };
}
