// A lens answer drawn on its time axis. Two layouts of the same answer: a calendar (./calendar.js: a column for each
// day, hours running down, each item a block where it falls, a lane per person and per session) and bars (./bars.js:
// each lane a row, each item a bar across the days it covers: a Gantt chart). Colour is what a block counts toward,
// else its type's; a name too long for its block is cut, and is whole in its tooltip. A block opens its item's page.
// It is drawn as wide as the page gives it (`width`), and laid out by the page: the frame does not pan or zoom it.
//
// A view a pack ships may say what its drawing sends (style `sends`, decision e_k9qu6s4g): `add`, called when an hour
// of the first person's lane is clicked, with the block's start and end and what the pack's aside asks; `aside`,
// asked for the days in sight, whose bands are drawn beside the calendar (./aside.js) and whose rows' acts are called
// when pressed. The page asks the person what an act needs and calls it as theirs; the drawing names no pack.
// Its look is ./look.js. A lens with steps tells the plan as it comes together (./story.js), the conversation beside it.

import { DAY, dayAt, dayOf, isoDay, weekday, zoneIs } from './clock.js';
import { controls } from './range.js';
import { css } from './look.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';
import { canvas } from './kit.js';
import { calendar } from './calendar.js';
import { bars } from './bars.js';
import { aside } from './aside.js';
import { m } from './marks.js';

/** The range the reader has up, for the view drawn last: kept when the page draws it again. */
let kept = {};

/** Draw a lens's answer along its time axis, in the style's layout, as wide as the page gives it (`width`). */
export function picture({ answer, style, width, height, reduced, may }, tools) {
  if (!answer.lens?.time) return { scene: { message: 'This view has no time axis.' } };
  zoneIs(answer.lens.time.zone);
  // A story lays out what its steps bring in, all of it, each block hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens.from) };
  }
  // What the view sends, by gesture; a session that may not write adds nothing.
  const sends = !story && style.sends && typeof style.sends === 'object' ? style.sends : {};
  const writes = Array.isArray(may) && may.includes('write');
  const adds = writes && typeof sends.add === 'string' && style.layout !== 'bars';
  // How many days are drawn, and from which, is the reader's to change over the picture (./range.js), within the
  // window the view asked for: the style's ranges are the choices, the whole window where it starts, kept while the
  // page has the view. A window longer than every range opens on the longest, on today's week where it is a week or
  // near one, and steps a week at a time.
  const days = Math.max(1, Math.round((dayOf(answer.lens.time.to) - dayOf(answer.lens.time.from)) / DAY) + 1);
  const from = dayOf(answer.lens.time.from);
  const ranges = (Array.isArray(style.ranges) ? style.ranges.map(Number) : []).filter((n) => n > 0 && n < days);
  const today = Math.round((dayOf(new Date().toISOString()) - from) / DAY);
  // A span this long or longer is a week (style numbers time_week_from): it starts on a Monday and steps a week (time_week).
  const weekly = (span) => span >= Number(style.numbers?.time_week_from);
  const startFor = (span) => (today < 0 || today >= days ? 0 : weekly(span) ? today - weekday(dayAt(from, today)) : today - Math.floor((span - 1) / 2));
  const opening = () => {
    const span = ranges.length ? Math.max(...ranges) : days;
    return { span, start: startFor(span) };
  };
  const id = JSON.stringify([answer.lens.time, answer.lens.find, answer.lens.only]);
  const now = (kept.id === id && kept.now) || opening();
  kept = { id, now };
  const fit = () => (now.start = Math.min(Math.max(0, now.start), days - now.span));
  fit();
  let c, drawn;
  const shownTime = () => ({ from: dayAt(from, now.start), to: dayAt(from, now.start + now.span - 1) });
  const draw = () => {
    c = { ...canvas(answer, style, width, story, height), story };
    // Every colour the style has is ruled for at once, so the picture drawn again over other days finds its own.
    for (const hex of style.hues ?? []) c.hued(hex);
    const t = shownTime();
    const shown = now.span === days ? answer : { ...answer, lens: { ...answer.lens, time: { ...answer.lens.time, from: new Date(t.from).toISOString(), to: new Date(t.to).toISOString() } } };
    drawn = style.layout === 'bars' ? bars(shown, style, c) : calendar(shown, style, c, adds);
    return drawn;
  };
  const { svg, key } = draw();
  const panel = () => ranges.length > 0 && controls(now, { days, from, ranges });
  let player = null;
  if (story) {
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks: c.shown, ...ctx }) } });
  }
  // The pack's aside for the days in sight, asked again as they change; a word of what went wrong stands at its head.
  let beside = null, said = null, turn = 0, asked = Promise.resolve();
  const besideMark = (note) => {
    beside = aside(said, c.z);
    const top = note && m('div', { key: 'ta-note', class: 'ta-said' }, String(note).slice(0, c.z('aside_tip_most')));
    return beside.mark ? (top && beside.mark.splice(2, 0, top), beside.mark) : m('div', { key: 'ta', class: 't-aside' }, top);
  };
  const askAside = () => {
    if (typeof sends.aside !== 'string') return;
    const mine = ++turn;
    const t = shownTime();
    asked = tools.act(sends.aside, { from: isoDay(t.from), to: isoDay(t.to) }).then((came) => {
      if (mine !== turn) return;
      said = came.error ? null : came.answer;
      tools.patch([{ key: 'ta', mark: besideMark(came.error) }]);
    });
  };
  askAside();
  /** Call an act the view sends (named by gesture or by a row), then say what went wrong, or open what it made. */
  const call = (name, params, asks, opens) =>
    tools.act(name, params, { asks }).then((came) => {
      if (came.error && came.error !== 'Not sent.') return [{ key: 'ta', mark: besideMark(came.error) }];
      const made = opens && (came.created ?? {})[opens];
      if (typeof made === 'string') tools.open(made);
      if (!came.error) askAside();
      return [];
    });
  // A calendar fits its hours to the height it is given: drawn again when that settles (`shaped`).
  const sideMark = player ? player.after : typeof sends.aside === 'string' ? m('div', { key: 'ta', class: 't-aside' }) : null;
  return {
    scene: { css: [css, ...c.rules, story ? storyCss : ''].join('\n'), svg, key, flat: true, ...(style.layout !== 'bars' && { shaped: true }), ...((player || panel()) && { before: player ? player.before : panel() }), ...(sideMark && { aside: sideMark }) },
    end: player?.end,
    async on(event) {
      if (player?.hears(event.key)) return player.on(event);
      if (event.name !== 'click' || typeof event.key !== 'string') return [];
      if (event.key.startsWith('tc:')) {
        const [, what, n] = event.key.split(':');
        // A narrower range keeps today in it where the window holds today, else the days it started from.
        if (what === 'span') (now.span = Number(n) || days), (now.start = startFor(now.span));
        else now.start += (what === 'next' ? 1 : -1) * (weekly(now.span) ? Number(style.numbers?.time_week) : 1);
        fit();
        askAside();
        return [{ key: 'tl', mark: draw().svg }, { key: 'tc', mark: panel() }];
      }
      if (event.key.startsWith('slot:') && adds) {
        const slot = drawn.slots?.get(event.key);
        if (!slot) return [];
        // What adding asks is the aside's: a click before it has come waits for it.
        await asked;
        const add = said?.add ?? {};
        return call(sends.add, { ...(add.params ?? {}), start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), ...(slot.start > Date.now() && { planned: true }) }, add.asks ?? []);
      }
      if (event.key.startsWith('ta:')) {
        const a = beside?.acts.get(event.key);
        return a ? call(a.act, a.params ?? {}, a.asks ?? [], a.opens) : [];
      }
      if (c.opens.has(event.key)) tools.open(c.opens.get(event.key));
      return [];
    },
    restyle: () => [],
  };
}
