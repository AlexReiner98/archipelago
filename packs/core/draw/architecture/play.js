// The steps of a story played, as patches to its marks (story.js): what a step takes away goes first, marked where it
// stands and then faded, while nothing else moves; then the rest move to where they go and what is new comes in, in
// the accent for a while, its wires drawn in. Beside the picture: the chapters (a rail) and what was said (a
// conversation), a line at a time. It plays on its own, a quick step at a fast-forward pace; a chapter can be chosen; with less motion asked for, it is the last step at once. Once a step
// changes the look, the key is the look's. Every time is the style's (numbers, arch_story_*).

import { m } from './marks.js';

export function play({ answer, style, reduced, tools, shape }) {
  const { frames, partAt, placeAt, wireAt, wireD, saysAt, keyOf, view, heads, pathOf, squareMorph, shift, looks, keyLooks, keyLook, family, dotsOf } = shape;
  const t = (name) => {
    const v = style.numbers?.[`arch_story_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no number "arch_story_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const steps = answer.steps, last = frames.length - 1;
  const chapters = steps.flatMap((s, k) => (s.chapter ? [{ ...s.chapter, at: k }] : []));
  const total = chapters.at(-1)?.count;

  // ---- Above the picture: the chapters, and what each dot says. Beside it: the conversation.
  // A key for the story's own look and one for each other look it changes to, each shown while its look is.
  const keyFor = (look) => {
    const names = dotsOf(look)?.names ?? {}, order = Array.isArray(dotsOf(look)?.order) ? dotsOf(look).order.map(String) : [];
    // In the order the dots give, then the rest.
    const values = [...order.filter((v) => v in names), ...Object.keys(names).filter((v) => !order.includes(v))];
    return values.length > 0 && m('ul', { key: `key:${look ?? ''}`, class: `sp-key${look ? ` sp-${look} sp-hide` : ''}` }, values.map((v) => m('li', {}, m('span', { class: `sp-swatch k-${v}` }), String(names[v]))));
  };
  const before = m(
    'div',
    { class: 'sp-top' },
    chapters.length > 0 && m('div', { class: 'sp-rail' }, chapters.map((c, k) => m('button', { key: `c:${k}`, on: ['click'], class: 'sp-era', title: [c.name, c.when].filter(Boolean).join(', ') }, m('b', {}, c.name), c.when && m('small', {}, c.when)))),
    [null, ...keyLooks].map(keyFor),
  );
  const after = m(
    'div',
    { key: 'chat', class: 'sp-chat' },
    m('div', { class: 'sp-head' }, m('span', { class: 'sp-live' }), m('span', { class: 'grow' }), total !== undefined && m('span', { key: 'count', class: 'sp-count' }, ''), m('button', { key: 'play', on: ['click'] }, reduced ? 'Play' : 'Pause')),
    m('ol', { key: 'log', class: 'sp-log', 'aria-live': 'polite' }),
  );

  // ---- Changing what is drawn.
  let timers = [], cur = -1, playing = false, seq = 0, typing = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const stop = () => (timers.forEach(clearTimeout), (timers = []));
  const send = (list) => list.length && tools.patch(list);
  const shown = new Map(); // what each wire's route is now

  const kept = t('lines_kept');
  const say = (kind, text, by) => {
    const key = `l:${seq++}`;
    const list = [{ key: 'log', append: m('li', { key, class: `sp-line ${kind}` }, by && m('span', { class: 'sp-who' }, by), m('p', {}, text)) }];
    if (seq > kept) list.push({ key: `l:${seq - kept - 1}`, remove: true });
    send(list);
    // In on the next frame, so it eases in.
    tools.frame().then(() => send([{ key, toggle: { in: true } }]));
  };
  const typingOn = (on) => {
    if (on === typing) return;
    typing = on;
    send(on ? [{ key: 'log', append: m('li', { key: 'typing', class: 'sp-line sp-typing in' }, m('p', {}, '…')) }] : [{ key: 'typing', remove: true }]);
  };
  /**
   * A step's lines: the last by someone is said as the step happens; those before it are said before it, and what
   * follows it (a line by nobody is a note) after. Each in its turn, or all at once.
   */
  const partsOf = (k) => {
    const all = steps[k].lines ?? [], at = all.findLastIndex((l) => l.by);
    return { before: at < 0 ? all : all.slice(0, at), end: at < 0 ? null : all[at], after: at < 0 ? [] : all.slice(at + 1) };
  };
  const kindOf = (l, end) => (!l.by ? 'note' : l === end ? 'theirs' : 'mine');
  const sayLines = (k) => {
    const { before, end, after } = partsOf(k);
    for (const l of [...before, ...(end ? [end] : []), ...after]) say(kindOf(l, end), l.text, l.by);
  };

  const rail = (k) => {
    const now = k < 0 ? -1 : frames[k].chapter;
    const list = chapters.map((_, n) => ({ key: `c:${n}`, toggle: { done: n < now || k === last, now: n === now && k !== last } }));
    // How far it had got: the chapter's count, reached by its last step.
    if (total !== undefined) {
      const c = chapters[now], start = now > 0 ? chapters[now - 1].count ?? 0 : 0, inIt = steps.map((_, s) => s).filter((s) => frames[s].chapter === now);
      const n = k < 0 || !c ? 0 : Math.round(start + ((c.count ?? start) - start) * ((inIt.indexOf(k) + 1) / inIt.length));
      list.push({ key: 'count', text: `${n} of ${total}` });
    }
    send(list);
  };

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

  // ---- Playing.
  const read = (text) => t('read_base') + text.length * t('read_per_char');
  const beat = (k) => {
    if (k > last) return finish();
    const s = steps[k], { before, end, after } = partsOf(k);
    // A quick step goes by at once, what it says with it, and the next follows as soon as it has.
    if (s.quick) {
      sayLines(k);
      apply(k, t('quick_move'));
      rail(k);
      later(t('quick') + (away(k) ? t('gone_hold') + t('gone_fade') : 0), () => beat(k + 1));
      return;
    }
    let at = 0;
    if (s.chapter) (later(at, () => say('chapter', [s.chapter.when, s.chapter.name].filter(Boolean).join(' · '))), (at += t('chapter_pause')));
    for (const l of before) (later(at, () => say(kindOf(l, end), l.text, l.by)), (at += read(l.text)));
    later(at, () => typingOn(true));
    at += t('typing');
    later(at, () => (typingOn(false), end && say('theirs', end.text, end.by), apply(k, t('move')), rail(k)));
    at += end ? read(end.text) : 0;
    for (const l of after) (later(at, () => say(kindOf(l, end), l.text, l.by)), (at += read(l.text)));
    at += Math.max(t('beat_least') - (end ? read(end.text) : 0), t('beat_after')) + (away(k) ? t('gone_hold') + t('gone_fade') : 0);
    later(at, () => beat(k + 1));
  };
  const finish = () => ((playing = false), send([{ key: 'play', text: 'Replay' }]));
  const replay = () => {
    stop();
    send([...Array.from({ length: seq }, (_, n) => ({ key: `l:${n}`, remove: true })), { key: 'typing', remove: true }]);
    typing = false;
    playing = true;
    send([{ key: 'play', text: 'Pause' }]);
    later(t('start'), () => beat(0));
  };
  /** Straight to step k, with what was said up to it. */
  const jump = (k, dur) => {
    stop();
    typingOn(false);
    send(Array.from({ length: seq }, (_, n) => ({ key: `l:${n}`, remove: true })));
    for (let s = 0; s <= k; s++) {
      if (steps[s].chapter) say('chapter', [steps[s].chapter.when, steps[s].chapter.name].filter(Boolean).join(' · '));
      sayLines(s);
    }
    apply(k, dur);
    rail(k);
    if (k === last) finish();
    else if (playing) later(t('beat_least'), () => beat(k + 1));
  };

  // It starts on its own, once the scene is on the page, unless less motion is asked for: then it is the last step at once.
  later(0, () => (reduced ? jump(last, 0) : ((playing = true), rail(-1), later(t('start'), () => beat(0)))));
  return {
    before,
    after,
    on({ name, key }) {
      if (name !== 'click') return [];
      if (key === 'play') {
        if (!playing && cur === last) replay();
        else if (playing) ((playing = false), jump(cur, 0), send([{ key: 'play', text: 'Play' }]));
        else ((playing = true), send([{ key: 'play', text: 'Pause' }]), beat(cur + 1));
      } else if (key.startsWith('c:')) jump(chapters[Number(key.slice(2))]?.at ?? 0, t('jump'));
      return [];
    },
    end: stop,
    /** The step on screen: -1 before the first. */
    step: () => cur,
  };
}
