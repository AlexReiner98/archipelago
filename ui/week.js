import { api, h, state } from './base.js';
import { chip } from './words.js';

// ---- Time ------------------------------------------------------------------

// Hours worked, a week at a time: each day with what was done and its total, a line to log more, and beside it what
// is owed: time not yet invoiced, invoices out and late, and drafts. Every entry and invoice is an item; this page
// points at them and writes through the same tools an agent uses.
export const timeState = { from: null };
export const LAST_WORK = 'pelago-time-work';
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const shiftDay = (day, n) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
export const mondayOf = (day) => shiftDay(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7));
export const dayName = (day, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts);
export const hoursText = (n) => `${Math.round(n * 100) / 100} h`;
export const moneyText = (n, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n) || 0);
export const remember = (key, value) => {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage, the last work is forgotten on reload.
  }
  return null;
};

/** A field that finds the work time is for, as it is typed: projects, tasks and clients. */
export function workPicker(initial, onPick) {
  let picked = initial ?? null;
  let turn = 0;
  const input = h('input', { type: 'search', class: 'tq-work', placeholder: 'Project or task', value: picked?.title ?? '', title: 'The project, task or client this time was for', autocomplete: 'off' });
  const list = h('div', { class: 'tq-picks', hidden: true });
  const find = async () => {
    const mine = ++turn;
    const q = input.value.trim();
    if (!q) return void (list.hidden = true);
    const hits = (await Promise.all(['work', 'company'].map((type) => api('search', { q, type, open: true, limit: 6 }).catch(() => [])))).flat();
    if (mine !== turn) return;
    list.replaceChildren(
      ...hits.slice(0, 8).map((x) =>
        h(
          'button',
          {
            type: 'button',
            onmousedown: (ev) => {
              ev.preventDefault();
              picked = { id: x.id, title: x.title };
              input.value = x.title;
              list.hidden = true;
              onPick?.(picked);
            },
          },
          chip(x.type),
          h('span', { class: 'gist' }, x.title),
        ),
      ),
    );
    list.hidden = !hits.length;
  };
  input.oninput = () => ((picked = null), find());
  input.onblur = () => setTimeout(() => (list.hidden = true), 150);
  return { el: h('span', { class: 'tq-picker' }, input, list), get: () => picked };
}

/** Hours since midnight as a time of day: 13.5 is 13:30. */
export const clockText = (n) => {
  const m = Math.round(n * 60);
  if (m === 1440) return '24:00';
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** A moment from a day and the hours since its midnight, as this browser keeps time. */
export const atHour = (day, hour) => {
  const d = new Date(`${day}T00:00:00`);
  d.setMinutes(Math.round(hour * 60));
  return d.toISOString();
};

/** The days of the week as a routine keeps them, 1 for Monday to 7 for Sunday, with their short names. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((n) => [n, new Date(Date.UTC(2026, 0, 4 + n)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })]);

/**
 * Ask what a block drawn on the calendar is: the work, a few words, whether it is only planned, and whether it repeats.
 * A block that repeats is a routine, and needs no work: dinner is for nothing.
 */
export function blockDialog(when, planned, day) {
  return new Promise((resolve) => {
    const picker = workPicker(remember(LAST_WORK), (w) => remember(LAST_WORK, w));
    const what = h('input', { type: 'text', maxlength: '60', placeholder: 'What', title: 'A few words: the block’s name', required: true });
    const plan = h('input', { type: 'checkbox', checked: planned });
    const planLabel = h('label', { class: 'tq-bill', title: 'Time set aside, not yet worked: it counts once you confirm it' }, plan, 'Planned');
    const repeat = h('select', { title: 'Whether it repeats' }, [['never', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['days', 'Days…']].map(([v, t]) => h('option', { value: v }, t)));
    const own = new Date(`${day}T12:00:00`).getDay() || 7;
    const ticks = WEEKDAYS.map(([n, name]) => h('label', { class: 'tq-bill' }, h('input', { type: 'checkbox', value: String(n), checked: n === own }), name));
    const dayRow = h('div', { class: 'cal-days', hidden: true }, ticks);
    repeat.onchange = repeat.oninput = () => {
      dayRow.hidden = repeat.value !== 'days';
      planLabel.hidden = repeat.value !== 'never';
      picker.el.querySelector('input').placeholder = repeat.value === 'never' ? 'Project or task' : 'Project or task, if it is work';
    };
    const dialog = h(
      'dialog',
      { class: 'ask cal-ask' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, when),
        picker.el,
        what,
        h('div', { class: 'cal-when' }, repeat, planLabel),
        dayRow,
        h('div', { class: 'toolbar' }, h('button', { value: 'cancel', formNoValidate: true }, 'Cancel'), h('button', { value: 'ok', class: 'primary' }, 'Add')),
      ),
    );
    const done = (value) => (dialog.remove(), resolve(value));
    dialog.firstChild.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return done(null);
      const work = picker.get();
      const days = { never: null, daily: [1, 2, 3, 4, 5, 6, 7], weekdays: [1, 2, 3, 4, 5], days: ticks.map((t) => t.firstChild).filter((c) => c.checked).map((c) => Number(c.value)) }[repeat.value];
      // Time worked is for some work; a routine may be for nothing.
      if (!work && !days) {
        e.preventDefault();
        return picker.el.querySelector('input').focus();
      }
      if (days && !days.length) return e.preventDefault();
      done({ work, what: what.value.trim(), planned: plan.checked, days });
    });
    dialog.addEventListener('cancel', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
    (picker.get() ? what : picker.el.querySelector('input')).focus();
  });
}

/** A choice of a few actions about one thing: resolves to the value of the one taken, or null. */
export function choose(title, choices) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'ask' }, h('form', { method: 'dialog' }, h('h2', {}, title), h('div', { class: 'toolbar' }, h('button', { value: '' }, 'Cancel'), choices.map(([value, label, cls]) => h('button', { value, class: cls ?? '' }, label)))));
    const done = (value) => (dialog.remove(), resolve(value || null));
    dialog.firstChild.addEventListener('submit', (e) => done(e.submitter?.value));
    dialog.addEventListener('cancel', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** A moment as this browser's time of day: 09:30. */
export const timeOfDay = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Ask what planned time actually was, before it counts: the work, a few words, the day and when it began and ended (or
 * its hours, for time planned without a time of day). Resolves to what was said, or null.
 */
export function happenedDialog(b) {
  return new Promise((resolve) => {
    const picker = workPicker(b.work_id ? { id: b.work_id, title: b.work } : null);
    const what = h('input', { type: 'text', maxlength: '60', value: b.what, title: 'A few words: the block’s name', required: true });
    const day = h('input', { type: 'date', value: b.date, title: 'The day it happened', required: true });
    const timed = Boolean(b.start && b.end);
    const from = h('input', { type: 'time', step: '300', value: timed ? timeOfDay(b.start) : '', title: 'When it began', required: true });
    const to = h('input', { type: 'time', step: '300', value: timed ? timeOfDay(b.end) : '', title: 'When it ended', required: true });
    const hrs = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', value: String(b.hours), title: 'Hours spent', required: true });
    const check = () => to.setCustomValidity(timed && from.value && to.value && to.value <= from.value ? 'It ends before it begins' : '');
    from.oninput = to.oninput = check;
    const dialog = h(
      'dialog',
      { class: 'ask cal-ask' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, 'What happened'),
        picker.el,
        what,
        h('div', { class: 'cal-when' }, day, timed ? [from, h('span', { class: 'muted' }, '–'), to] : hrs),
        h('div', { class: 'toolbar' }, h('button', { value: 'cancel', formNoValidate: true }, 'Cancel'), h('button', { value: 'ok', class: 'primary' }, 'Confirm')),
      ),
    );
    const done = (value) => (dialog.remove(), resolve(value));
    dialog.firstChild.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return done(null);
      const work = picker.get();
      if (!work) {
        e.preventDefault();
        return picker.el.querySelector('input').focus();
      }
      const start = timed ? new Date(`${day.value}T${from.value}:00`).toISOString() : null;
      const end = timed ? new Date(`${day.value}T${to.value}:00`).toISOString() : null;
      const hours = timed ? Math.round(((Date.parse(end) - Date.parse(start)) / 3_600_000) * 100) / 100 : Number(hrs.value);
      done({ work, what: what.value.trim(), date: day.value, start, end, hours });
    });
    dialog.addEventListener('cancel', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
    what.focus();
  });
}

/** The ops that confirm planned time as it was said to have happened: the entry is logged, and moved to other work if it was. */
export const confirmEntryOps = (b, v) => [
  { op: 'update', id: b.id, status: 'logged', title: v.what, props: { date: v.date, hours: v.hours, ...(v.start && { start: v.start, end: v.end }) } },
  ...(v.work.id !== b.work_id ? [...(b.link ? [{ op: 'unlink', relation: b.link }] : []), { op: 'link', type: 'part_of', from: b.id, to: v.work.id }] : []),
];

/** The ops that confirm a day of a routine: a time entry for what happened, and the day marked done on the routine. */
export async function confirmRoutineOps(b, v) {
  const p = (await api('get', { id: b.id })).entity.props;
  return [
    { op: 'create', ref: 'e', type: 'time.entry', title: v.what, status: 'logged', props: { date: v.date, hours: v.hours, ...(v.start && { start: v.start, end: v.end }) } },
    { op: 'link', type: 'part_of', from: 'e', to: v.work.id },
    { op: 'update', id: b.id, props: { done: [...(Array.isArray(p.done) ? p.done : []), b.date] } },
  ];
}

/**
 * The week as a calendar: a column for each day, split into the owner's lane and a narrow lane for each agent at work at
 * once; time runs down, and each block is coloured by the project it counts toward. Time logged as hours alone has no
 * place in the day, so it is a strip above it. In the owner's lane a block is drawn by dragging, and moved or stretched
 * the same way; time ahead is planned, and counts only once it is confirmed.
 */
/** The hours and days the calendar opens on; the rest is one toggle away. */
export const CAL_HOURS = [6, 22];
export const CAL_DAYS = 5;
export const CAL_FULL = 'pelago-cal-full';
/** Whether the week has anything outside the hours and days shown by default. */
export const calHidden = (wk) =>
  wk.days.some((d, i) => {
    const all = [...d.owner.filter((b) => !b.routine), ...d.agents.flat()];
    if (i >= CAL_DAYS) return all.length > 0;
    return all.some((b) => b.from_hour != null && (b.from_hour < CAL_HOURS[0] || b.to_hour > CAL_HOURS[1]));
  });

export function weekCalendar(wk, today, act, full) {
  const hues = state.style.hues; // the workspace's style says how projects are told apart
  const hueOf = new Map(wk.projects.map((p, i) => [p.id, hues[i % hues.length]]));
  const titleOf = new Map(wk.projects.map((p) => [p.id, p.title]));
  // The waking day on weekdays, unless the whole of it is asked for; a block that runs past the edge is cut there.
  const [top, bottom] = full ? [0, 24] : CAL_HOURS;
  const days = full ? wk.days : wk.days.slice(0, CAL_DAYS);
  const span = bottom - top;
  const seen = (b) => b.to_hour > top && b.from_hour < bottom;
  const place = (from, to) => {
    const [a, z] = [Math.max(from, top), Math.min(to, bottom)];
    return `top: ${((a - top) / span) * 100}%; height: max(2px, ${((z - a) / span) * 100}%)`;
  };
  const colour = (b) => `--cal-hue: ${hueOf.get(b.project) ?? 'var(--closed)'}`;
  const tip = (b) =>
    [
      [titleOf.get(b.project), b.what].filter(Boolean).join(' · '),
      b.work && b.work !== b.what && b.work !== titleOf.get(b.project) ? b.work : null,
      b.from_hour != null ? `${clockText(b.from_hour)}–${clockText(b.to_hour)} · ${hoursText(b.hours)}` : hoursText(b.hours),
      b.status === 'planned' ? 'Planned' : b.routine ? 'Repeats' : null,
      b.session && b.session !== b.what ? `Agent: ${b.session}${b.open ? ' (running)' : ''}` : b.session ? `Agent${b.open ? ', running' : ''}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  const hours = [...Array(span)].map((_, i) => top + i);
  const snap = (n) => Math.min(bottom, Math.max(top, Math.round(n * 4) / 4));
  const hourAt = (lane, y) => {
    const r = lane.getBoundingClientRect();
    return snap(top + ((y - r.top) / r.height) * span);
  };
  const laneAt = (x) =>
    [...document.querySelectorAll('.cal-owner')].find((l) => {
      const r = l.parentElement.getBoundingClientRect();
      return x >= r.left && x < r.right;
    });

  // An owner's block is moved by dragging it, and stretched by its lower edge; a click opens it.
  const mineEl = (b) => {
    const el = h(
      'a',
      { class: `cal-block cal-mine${b.status === 'planned' || (b.routine && b.work_id) ? ' cal-planned' : ''}${b.routine ? ' cal-routine' : ''}${b.routine && !b.work_id ? ' cal-own' : ''}`, href: `#/e/${b.id}`, title: tip(b), style: `${place(b.from_hour, b.to_hour)}; ${colour(b)}` },
      b.to_hour - b.from_hour >= 0.75 ? h('span', { class: 'cal-what' }, b.what) : null,
    );
    if (!act || b.status === 'invoiced' || b.start == null) return el;
    el.append(h('span', { class: 'cal-grip', title: 'Drag to change when it ends' }));
    let drag = null;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      state.dirty = true;
      drag = { y: ev.clientY, x: ev.clientX, moved: false, grip: ev.target.classList.contains('cal-grip'), from: b.from_hour, to: b.to_hour, lane: el.parentElement, at: hourAt(el.parentElement, ev.clientY) };
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(ev.clientY - drag.y) + Math.abs(ev.clientX - drag.x) < 5) return;
      drag.moved = true;
      if (drag.grip) {
        drag.to = Math.max(drag.from + 0.25, hourAt(drag.lane, ev.clientY));
      } else {
        // A day of a routine moves within its day; the routine itself is changed on its page.
        const lane = b.routine ? drag.lane : (laneAt(ev.clientX) ?? drag.lane);
        if (lane !== el.parentElement) lane.append(el);
        drag.lane = lane;
        const length = b.to_hour - b.from_hour;
        drag.from = Math.min(bottom - length, Math.max(top, snap(b.from_hour + hourAt(lane, ev.clientY) - drag.at)));
        drag.to = drag.from + length;
      }
      el.style.top = `${((drag.from - top) / span) * 100}%`;
      el.style.height = `${((drag.to - drag.from) / span) * 100}%`;
    });
    const finish = () => {
      const was = drag;
      drag = null;
      state.dirty = false;
      if (was && !was.moved && b.routine) {
        el.addEventListener('click', (e) => e.preventDefault(), { once: true });
        return act.routineDay(b);
      }
      if (!was?.moved) return;
      // The click that ends a drag does not open the block.
      el.addEventListener('click', (e) => e.preventDefault(), { once: true });
      const day = was.lane.dataset.date;
      if (day === b.date && was.from === b.from_hour && was.to === b.to_hour) return;
      act.move(b, day, was.from, was.to);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    return el;
  };

  // A new block is drawn by dragging down the owner's lane; a click alone sets aside an hour.
  const ownerLane = (d) => {
    const lane = h('div', { class: 'cal-lane cal-owner', 'data-date': d.date, title: act ? 'Drag to add a block' : '' }, d.owner.filter((b) => b.from_hour != null && seen(b)).map((b) => mineEl({ ...b, date: d.date })));
    if (!act) return lane;
    let draw = null;
    lane.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target !== lane) return;
      ev.preventDefault();
      lane.setPointerCapture(ev.pointerId);
      state.dirty = true;
      const at = hourAt(lane, ev.clientY);
      draw = { at, from: at, to: at, ghost: h('div', { class: 'cal-block cal-ghost', style: place(at, at + 0.25) }) };
      lane.append(draw.ghost);
    });
    lane.addEventListener('pointermove', (ev) => {
      if (!draw) return;
      const at = hourAt(lane, ev.clientY);
      [draw.from, draw.to] = at < draw.at ? [at, draw.at] : [draw.at, at];
      draw.ghost.style.cssText = place(draw.from, Math.max(draw.to, draw.from + 0.25));
    });
    const finish = async () => {
      if (!draw) return;
      const { from, to, ghost } = draw;
      draw = null;
      const end = to - from < 0.25 ? Math.min(bottom, from + 1) : to;
      ghost.style.cssText = place(from, end);
      await act.add(d.date, from, end);
      ghost.remove();
      state.dirty = false;
    };
    lane.addEventListener('pointerup', finish);
    lane.addEventListener('pointercancel', () => (draw?.ghost.remove(), (draw = null), (state.dirty = false)));
    return lane;
  };

  return h(
    'section',
    { class: 'card cal' },
    h(
      'header',
      { class: 'cal-legend' },
      wk.projects.length ? wk.projects.map((p) => h('a', { class: 'cal-key', href: `#/e/${p.id}`, title: p.title, style: `--cal-hue: ${hueOf.get(p.id)}` }, p.title)) : h('span', { class: 'muted small' }, 'Nothing this week.'),
    ),
    h(
      'div',
      { class: 'cal-scroll' },
      h(
        'div',
        { class: 'cal-grid', style: `grid-template-columns: 44px repeat(${days.length}, minmax(64px, 1fr))` },
        h('div', { class: 'cal-axis' }, h('div', { class: 'cal-head' }), h('div', { class: 'cal-loose' }), h('div', { class: 'cal-body' }, [...hours, bottom].filter((n) => n === top || n === bottom || span <= 16 || n % 2 === 0).map((n) => h('span', { class: `cal-hour${n === top ? ' cal-first' : n === bottom ? ' cal-last' : ''}`, style: `top: ${((n - top) / span) * 100}%` }, clockText(n))))),
        days.map((d) => {
          const loose = d.owner.filter((b) => b.from_hour == null);
          const lanes = d.agents.length;
          const said = [`${hoursText(d.hours)} of your time`, d.planned && `${hoursText(d.planned)} planned`, lanes && `${lanes} agent${lanes === 1 ? '' : 's'} at once at most`, d.reported && `${d.reported} run${d.reported === 1 ? '' : 's'} reported when done`].filter(Boolean).join(', ');
          return h(
            'div',
            { class: `cal-day${d.date === today ? ' cal-today' : ''}` },
            h('div', { class: 'cal-head', title: said }, h('span', { class: 'gist' }, dayName(d.date, { weekday: 'short', day: 'numeric' })), d.hours ? h('span', { class: 'tq-h muted small' }, hoursText(d.hours)) : null),
            h('div', { class: 'cal-loose' }, loose.map((b) => h('a', { class: `cal-chip${b.status === 'planned' ? ' cal-planned' : ''}`, href: `#/e/${b.id}`, title: tip(b), style: `flex-grow: ${b.hours}; ${colour(b)}` }))),
            h(
              'div',
              { class: 'cal-body', style: `--cal-agents: ${lanes}` },
              hours.map((n) => h('span', { class: 'cal-rule', style: `top: ${((n - top) / span) * 100}%` })),
              ownerLane(d),
              d.agents.map((lane) => h('div', { class: 'cal-lane cal-agent' }, lane.filter(seen).map((b) => h('a', { class: 'cal-block cal-run', href: `#/e/${b.id}`, title: tip(b), style: `${place(b.from_hour, b.to_hour)}; ${colour(b)}` })))),
            ),
          );
        }),
      ),
    ),
  );
}
