// The steps of a story played: above the picture, the chapters (a rail); beside it, what was said (a conversation), a
// line at a time; and each step shown on the picture's own stage (`shape.stage`: the architecture's moves.js, the
// flow's reveal). It plays on its own, a quick step at a fast-forward pace; a chapter can be chosen, and a step taken
// back or on; with less motion asked for, it is the last step at once, and so it is where it is played only when
// asked (style.play "asked": a view up on the canvas, which opens on the map as it is). Once a step changes the look, the key is the look's. Every time is the
// style's (numbers, arch_story_*). Shared by the drawings that tell stories.
// A step that adds a kept view (an item of the lens type) reaches a milestone: that view's own drawing stands beside
// the picture, as large as it, until a later step adds another, and the conversation moves to the left, narrow (the
// owner, 2 Nov 2026, e_dnewbxxh). The page draws it from a `view` mark (ui/view-frame.js): a drawing never opens a view.
// A story none of whose steps says anything has no conversation: the map tells it, and the player's buttons stand at
// the end of the chapters' row (the owner, 3 Nov 2026, e_7vdaan2k).

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
  // The milestone each step shows: the last kept view added by then.
  const views = new Map((answer.items ?? []).filter((i) => i.type === 'lens').map((i) => [i.id, i.title]));
  const shownAt = [];
  for (const s of steps) shownAt.push((s.add ?? []).filter((id) => views.has(id)).at(-1) ?? shownAt.at(-1) ?? null);
  const milestones = shownAt.some(Boolean);
  const reaches = (k) => Boolean(shownAt[k]) && shownAt[k] !== (shownAt[k - 1] ?? null);
  const talks = steps.some((s) => s.lines?.length);

  // ---- Above the picture: the chapters, and what each dot says. Beside it: the conversation.
  // A key for the story's own look and one for each other look it changes to, each shown while its look is.
  const keyFor = (look) => {
    const names = dotsOf(look)?.names ?? {}, order = Array.isArray(dotsOf(look)?.order) ? dotsOf(look).order.map(String) : [];
    // In the order the dots give, then the rest.
    const values = [...order.filter((v) => v in names), ...Object.keys(names).filter((v) => !order.includes(v))];
    return values.length > 0 && m('ul', { key: `key:${look ?? ''}`, class: `sp-key${look ? ` sp-${look} sp-hide` : ''}` }, values.map((v) => m('li', {}, m('span', { class: `sp-swatch k-${v}` }), String(names[v]))));
  };
  // The player's buttons: atop the conversation, or, with none, at the end of the chapters' row.
  const head = m(
    'div',
    { class: 'sp-head' },
    m('span', { class: 'sp-live' }),
    m('span', { class: 'grow' }),
    total !== undefined && m('span', { key: 'count', class: 'sp-count' }, ''),
    m('span', { key: 'at', class: 'sp-count', title: 'The step shown, of all the steps' }, ''),
    m('button', { key: 'back', on: ['click'], class: 'sp-step', title: 'A step back' }, '‹'),
    m('button', { key: 'play', on: ['click'] }, 'Play'),
    m('button', { key: 'next', on: ['click'], class: 'sp-step', title: 'A step on' }, '›'),
  );
  const eras = chapters.length > 0 && m('div', { class: 'sp-rail' }, chapters.map((c, k) => m('button', { key: `c:${k}`, on: ['click'], class: 'sp-era', title: [c.name, c.when].filter(Boolean).join(', ') }, m('b', {}, c.name), c.when && m('small', {}, c.when))));
  const before = m(
    'div',
    { class: 'sp-top', ...(!talks && { key: 'top', on: ['seen'] }) },
    talks ? eras : m('div', { class: 'sp-row' }, eras, m('div', { class: 'sp-controls' }, head)),
    [null, ...keyLooks].map(keyFor),
  );
  const chat = talks && m('div', { key: 'chat', on: ['seen'], class: 'sp-chat' }, head, m('ol', { key: 'log', class: 'sp-log', 'aria-live': 'polite' }));
  // Beside the picture: the milestone reached, its name under it, a link to its page.
  const after = milestones ? m('div', { class: 'sp-side' }, chat, m('div', { class: 'sp-shown' }, m('view', { key: 'shown' }), m('a', { key: 'shown-name', class: 'sp-shown-name' }, ''))) : chat || null;

  // ---- Changing what is drawn.
  let timers = [], cur = -1, playing = false, seq = 0, typing = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const stop = () => (timers.forEach(clearTimeout), (timers = []));
  const send = (list) => list.length && tools.patch(list);

  const kept = t('lines_kept');
  const say = (kind, text, by) => {
    if (!talks) return;                                            // no conversation to say it in
    const key = `l:${seq++}`;
    const list = [{ key: 'log', append: m('li', { key, class: `sp-line ${kind}` }, by && m('span', { class: 'sp-who' }, by), m('p', {}, text)) }];
    if (seq > kept) list.push({ key: `l:${seq - kept - 1}`, remove: true });
    send(list);
    // In on the next frame, so it eases in.
    tools.frame().then(() => send([{ key, toggle: { in: true } }]));
  };
  const typingOn = (on) => {
    if (on === typing || !talks) return;
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
    list.push({ key: 'at', text: k < 0 ? '' : `${k + 1} of ${steps.length}` });
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
  let showing = null;
  const showView = (k) => {
    const id = k < 0 ? null : shownAt[k];
    if (!milestones || id === showing) return;
    showing = id;
    send([{ key: 'shown', mark: m('view', { key: 'shown', ...(id && { id }) }) }, { key: 'shown-name', text: id ? views.get(id) : '', set: { href: id ? `#/e/${id}` : null, title: id ? views.get(id) : null } }]);
  };
  const apply = (k, dur) => ((cur = k), stage.apply(k, dur), showView(k));
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
      later(t('quick') + (away(k) ? t('gone_hold') + t('gone_fade') : 0) + (reaches(k) ? t('milestone') : 0), () => beat(k + 1));
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
    // A milestone reached holds a while longer, for its drawing to be seen.
    at += Math.max(t('beat_least') - (end ? read(end.text) : 0), t('beat_after')) + (away(k) ? t('gone_hold') + t('gone_fade') : 0) + (reaches(k) ? t('milestone') : 0);
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
  const asked = style.play === 'asked';
  if (reduced || asked) later(0, () => ((started = true), jump(last, 0), asked && send([{ key: 'play', text: 'Play' }])));
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
      } else if (key === 'back' || key === 'next') {
        // A step taken by hand holds there: it is paused.
        playing = false;
        send([{ key: 'play', text: 'Play' }]);
        jump(Math.max(0, Math.min(last, cur + (key === 'next' ? 1 : -1))), t('jump'));
      } else if (key.startsWith('c:')) {
        // A chapter chosen plays from its start, paused or not.
        playing = true;
        send([{ key: 'play', text: 'Pause' }]);
        jump(chapters[Number(key.slice(2))]?.at ?? 0, t('jump'));
      }
      return [];
    },
    end: stop,
    /** Whether a mark's event is the player's: its buttons, a chapter, the conversation (or, with none, the top). */
    hears: (key) => ['play', 'back', 'next', 'chat', 'top'].includes(key) || key.startsWith('c:'),
    /** The step on screen: -1 before the first. */
    step: () => cur,
  };
}
