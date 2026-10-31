// The steps of a story played: above the picture, the chapters (a rail); beside it, what was said (a conversation), a
// line at a time; and each step shown on the picture's own stage (`shape.stage`: the architecture's moves.js, the
// flow's reveal). It plays on its own, a quick step at a fast-forward pace; a chapter can be chosen; with less motion
// asked for, it is the last step at once. Once a step changes the look, the key is the look's. Every time is the
// style's (numbers, arch_story_*). Shared by the drawings that tell stories.

import { m } from './marks.js';

export function play({ answer, style, reduced, tools, shape }) {
  const { frames, keyLooks = [], dotsOf = () => null } = shape;
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
    { key: 'chat', on: ['seen'], class: 'sp-chat' },
    m('div', { class: 'sp-head' }, m('span', { class: 'sp-live' }), m('span', { class: 'grow' }), total !== undefined && m('span', { key: 'count', class: 'sp-count' }, ''), m('button', { key: 'play', on: ['click'] }, 'Play')),
    m('ol', { key: 'log', class: 'sp-log', 'aria-live': 'polite' }),
  );

  // ---- Changing what is drawn.
  let timers = [], cur = -1, playing = false, seq = 0, typing = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const stop = () => (timers.forEach(clearTimeout), (timers = []));
  const send = (list) => list.length && tools.patch(list);

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

  // ---- Showing a step, on the picture's own stage.
  const stage = shape.stage({ t, send, later });
  const apply = (k, dur) => ((cur = k), stage.apply(k, dur));
  const away = (k) => stage.away(k);

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

  // It starts on its own once the conversation is scrolled into sight (`seen`), unless less motion is asked for: then
  // it is the last step at once. Played or paused before, it is not started again.
  let started = false;
  const begin = () => !started && ((started = true), (playing = true), send([{ key: 'play', text: 'Pause' }]), rail(-1), later(t('start'), () => beat(0)));
  if (reduced) later(0, () => ((started = true), jump(last, 0)));
  return {
    before,
    after,
    on({ name, key }) {
      if (name === 'seen') return (begin(), []);
      if (name !== 'click') return [];
      started = true;
      if (key === 'play') {
        if (!playing && cur === last) replay();
        // Paused before its first step is drawn, the story only stops: there is no step to hold.
        else if (playing) ((playing = false), cur >= 0 ? jump(cur, 0) : (stop(), typingOn(false)), send([{ key: 'play', text: 'Play' }]));
        else ((playing = true), send([{ key: 'play', text: 'Pause' }]), beat(cur + 1));
      } else if (key.startsWith('c:')) {
        // A chapter chosen plays from its start, paused or not.
        playing = true;
        send([{ key: 'play', text: 'Pause' }]);
        jump(chapters[Number(key.slice(2))]?.at ?? 0, t('jump'));
      }
      return [];
    },
    end: stop,
    /** The step on screen: -1 before the first. */
    step: () => cur,
  };
}
