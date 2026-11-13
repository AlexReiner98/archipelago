// The catch_up pack's part catch_up.replay, on the trace overlay over a canvas (the slot `traces`): since you last
// looked, played. The runtime keeps where the log stood when the person last looked, and when a page opens later it
// hands what changed on the canvas since (`missed`: each entry, its facts, and the rows they touched before and after).
// This offers it in a band over the canvas: how many items changed, Play, Skip and leave it. Play takes the canvas back
// to where the person left it and replays the log from there a step at a time (the `replay` mark: the runtime moves the
// store to step `at`, each a scene the transition engine moves into), chapters by who made them, each island by
// island; the timer is here, every time the style's (`catch_up_*`). With no replay mark the canvas is the map as it is.

import { whoSaid } from './changes.js';
import { changedCount, stepsOf } from './steps.js';

/** The times where the style says nothing, in milliseconds. */
const START = 500;
const STEP = 1600;

export default function replay(input, tools) {
  let now = input;
  /** What is offered: its steps, and how many it has played (undefined: not playing). */
  let offered = null;
  let timer = 0;
  const number = (name, or) => now?.style?.numbers?.[name] ?? or;

  function offer(missed) {
    const steps = stepsOf(missed?.entries, { islands: missed?.islands, me: now?.me ?? missed?.me });
    offered = steps.length ? { steps, count: changedCount(steps) } : null;
  }
  if (input?.missed) offer(input.missed);

  const band = (o) => {
    const playing = o.played !== undefined;
    const step = playing ? o.steps[o.played - 1] : undefined;
    return [
      'box',
      { key: 'catch-up', look: 'band', flow: 'row', gap: 2, align: 'center', tip: 'What changed since you last looked' },
      ['text', { look: 'mark' }, playing ? `${o.played} of ${o.steps.length}` : `${o.count} changed`],
      ...(step ? [['text', { look: 'muted', ...(step.by?.word && { word: step.by.word }) }, whoSaid(step.by)]] : []),
      ...(playing ? [] : [['button', { key: 'play', look: 'main', tip: 'Play what changed since you last looked, a step at a time' }, 'Play']]),
      ['button', { key: 'skip', look: 'quiet', tip: 'The map as it is now' }, 'Skip'],
      ['button', { key: 'shut', look: 'quiet', tip: 'Leave it: what changed stays traced' }, '×'],
    ];
  };
  const draw = () => {
    if (!offered) return ['box', { key: 'catch-up-none' }];
    const o = offered;
    if (o.played === undefined) return band(o);
    return ['box', { key: 'catch-up-playing' }, band(o), ['replay', { at: o.played, steps: o.steps.map((s) => ({ pos: s.pos, ids: s.ids })) }]];
  };
  const tell = () => tools?.marks?.(draw());

  /** The map as it is now: the band gone, and no replay mark, so the runtime projects what was not played. */
  function end() {
    clearTimeout(timer);
    offered = null;
    return draw();
  }
  function play() {
    const o = offered;
    if (!o || o.played !== undefined) return undefined;
    o.played = 0;
    const next = () => {
      if (offered !== o) return;
      if (o.played >= o.steps.length) return void tools?.marks?.(end());
      o.played++;
      tell();
      timer = setTimeout(next, number('catch_up_step', STEP));
    };
    timer = setTimeout(next, number('catch_up_start', START));
    return draw();
  }

  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    on(event) {
      if (event?.name === 'missed') return offered ? undefined : (offer(event), draw());
      if (event?.name !== 'press') return undefined;
      if (event.key === 'play') return play();
      if (event.key === 'skip' || event.key === 'shut') return offered ? end() : undefined;
      return undefined;
    },
  };
}
