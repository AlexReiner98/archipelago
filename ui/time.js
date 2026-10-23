// The Time screen.

import { api, ask, h, part, state, tell } from './base.js';
import { CAL_FULL, LAST_WORK, atHour, blockDialog, calHidden, choose, clockText, confirmEntryOps, confirmRoutineOps, dayName, happenedDialog, hoursText, localDay, mondayOf, moneyText, remember, shiftDay, timeState, weekCalendar, workPicker } from './week.js';
import { menu } from './words.js';

export async function time() {
  const main = part('time');
  const today = localDay();
  const from = timeState.from ?? mondayOf(today);
  const to = shiftDay(from, 6);
  let sheet, wk;
  try {
    [sheet, wk] = await Promise.all([api('time_timesheet', { from, to }), api('time_week', { from })]);
  } catch (err) {
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const again = () => ((state.dirty = false), time());
  const week = (n) => () => ((timeState.from = n === 0 ? null : shiftDay(from, n * 7)), again());
  const write = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      (state.selfDrawn = true), again();
    } catch (err) {
      tell('That was not saved', err.message);
    }
  };

  // The line to log more: the day (today when this week is shown), hours, the work, what was done, a note, whether it is billed.
  const picker = workPicker(remember(LAST_WORK), (w) => remember(LAST_WORK, w));
  const date = h('input', { type: 'date', value: today >= from && today <= to ? today : from, title: 'The day the work was done', required: true });
  const hours = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', placeholder: 'Hours', title: 'Hours spent', required: true });
  const what = h('input', { type: 'text', class: 'tq-what', maxlength: '60', placeholder: 'What you did', title: 'A few words: the entry\u2019s name', required: true });
  const note = h('input', { type: 'text', class: 'tq-note', placeholder: 'Note', title: 'More about the work, if there is more to say' });
  const billable = h('input', { type: 'checkbox', checked: true });
  const add = h(
    'form',
    {
      class: 'tq-add card',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const work = picker.get();
        if (!work) return tell('Which work was it for?', 'Choose a project, task or client from the list as you type.');
        try {
          const { answer: made } = await api('time_log', { work: work.id, hours: Number(hours.value), what: what.value.trim(), note: note.value.trim() || undefined, date: date.value, billable: billable.checked ? undefined : false });
          if (!made.client) await tell('Logged, with no client', made.note ?? 'This work involves no company, so it is not invoiced.');
          (state.selfDrawn = true), again();
        } catch (err) {
          tell('That was not logged', err.message);
        }
      },
    },
    date,
    hours,
    picker.el,
    what,
    note,
    h('label', { class: 'tq-bill', title: 'Goes on an invoice' }, billable, 'Billable'),
    h('button', { type: 'submit', class: 'primary' }, 'Log'),
  );

  // One line per entry; in place, its fields to change. What is invoiced is kept as billed.
  const entryRow = (e) => {
    const li = h('li', { class: 'row-top tq-entry' });
    // The parts of the line, less those that say nothing: replaceChildren would write them out as words.
    const show = () =>
      li.replaceChildren(
        ...[
        h('a', { class: 'gist tq-what-text', href: `#/e/${e.id}`, title: [e.what, e.note].filter(Boolean).join('\n') }, e.what),
        e.note && h('span', { class: 'gist muted small tq-note-text', title: e.note }, e.note),
        e.work_id ? h('a', { class: 'gist muted small tq-work-text', href: `#/e/${e.work_id}`, title: e.client ? `${e.work} \u2192 billed to ${e.client}` : `${e.work}: no client` }, e.work) : h('span', { class: 'muted small tq-work-text', title: 'Not tied to any work, so it has no client' }, 'no work'),
        e.billable === false && h('span', { class: 'pill closed', title: 'Not invoiced' }, 'not billable'),
        e.status !== 'logged' && h('span', { class: 'pill closed', title: 'On an invoice' }, e.status),
        h('span', { class: 'tq-h' }, hoursText(e.hours)),
        e.status === 'logged' &&
          menu('\u22ef', [
            ['Edit', edit],
            [
              'Remove',
              async () => (await ask({ title: `Remove "${e.what}"?`, message: `${hoursText(e.hours)} on ${dayName(e.date ?? day)}`, action: 'Remove', danger: true })) && write([{ op: 'archive', id: e.id }], 'Removed on the Time screen'),
              'danger',
            ],
          ]),
        ].filter(Boolean),
      );
    const edit = () => {
      state.dirty = true;
      const d = h('input', { type: 'date', value: e.date });
      const hrs = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', value: String(e.hours) });
      const w = h('input', { type: 'text', class: 'tq-what', maxlength: '60', value: e.what });
      const n = h('input', { type: 'text', class: 'tq-note', value: e.note ?? '', placeholder: 'Note' });
      const b = h('input', { type: 'checkbox', checked: e.billable !== false });
      li.replaceChildren(
        h(
          'form',
          {
            class: 'tq-edit',
            onsubmit: (ev) => (
              ev.preventDefault(),
              write([{ op: 'update', id: e.id, title: w.value.trim(), body: n.value.trim(), props: { date: d.value, hours: Number(hrs.value), billable: b.checked ? null : false } }], 'Edited on the Time screen')
            ),
          },
          d,
          hrs,
          w,
          n,
          h('label', { class: 'tq-bill' }, b, 'Billable'),
          h('button', { type: 'submit', class: 'primary' }, 'Save'),
          h('button', { type: 'button', onclick: () => ((state.dirty = false), show()) }, 'Cancel'),
        ),
      );
      w.focus();
    };
    show();
    return li;
  };

  // The days of the week that have time, and today.
  const byDay = new Map(sheet.days.map((d) => [d.date, d]));
  let day;
  const days = [...Array(7)]
    .map((_, i) => shiftDay(from, i))
    .filter((d) => byDay.has(d) || d === today)
    .map((d) => {
      day = d;
      const one = byDay.get(d) ?? { hours: 0, entries: [] };
      return h(
        'section',
        { class: 'card tq-day' },
        h('header', { class: 'tq-dayhead' }, h('span', { class: 'grow' }, dayName(d, { weekday: 'long', day: 'numeric', month: 'long' })), h('span', { class: 'tq-h' }, hoursText(one.hours))),
        one.entries.length ? h('ul', { class: 'rows' }, one.entries.map((e) => entryRow({ ...e, date: d }))) : h('div', { class: 'empty' }, 'Nothing logged yet.'),
      );
    });

  // The calendar writes through the same tools: a drawn block is logged (or planned, when it is ahead), a moved one updated.
  const calendarActs = {
    add: async (day, from, to) => {
      const start = atHour(day, from);
      const end = atHour(day, to);
      const said = await blockDialog(`${dayName(day)}, ${clockText(from)}\u2013${clockText(to)}`, Date.parse(end) > Date.now(), day);
      if (!said) return;
      try {
        if (said.days)
          await api('change', {
            ops: [
              { op: 'create', ref: 'r', type: wk.types.routine, title: said.what, status: 'active', props: { from_time: clockText(from), to_time: clockText(to), days: said.days, starts: day } },
              ...(said.work ? [{ op: 'link', type: 'part_of', from: 'r', to: said.work.id }] : []),
            ],
            reason: 'Made a routine on the Time screen',
          });
        else await api('time_log', { work: said.work.id, what: said.what, start, end, ...(said.planned && { planned: true }) });
        (state.selfDrawn = true), again();
      } catch (err) {
        tell('That was not added', err.message);
      }
    },
    routineDay: async (b) => {
      const said = await choose(`${b.what} \u00b7 ${dayName(b.date)}, ${clockText(b.from_hour)}\u2013${clockText(b.to_hour)}`, [['open', 'Open routine'], ['skip', 'Skip this day', 'danger']]);
      if (said === 'open') location.hash = `#/e/${b.id}`;
      if (said !== 'skip') return;
      const p = (await api('get', { id: b.id })).entity.props;
      write([{ op: 'update', id: b.id, props: { skip: [...(Array.isArray(p.skip) ? p.skip : []), b.date] } }], `Skipped ${b.date} on the Time screen`);
    },
    move: async (b, day, from, to) => {
      if (!b.routine) return moveEntry(b, day, from, to);
      const p = (await api('get', { id: b.id })).entity.props;
      write([{ op: 'update', id: b.id, props: { moved: { ...(p.moved && typeof p.moved === 'object' ? p.moved : {}), [b.date]: [clockText(from), clockText(to)] } } }], `Moved ${b.date} on the Time screen`);
    },
  };
  const moveEntry = (b, day, from, to) =>
    write([{ op: 'update', id: b.id, props: { start: atHour(day, from), end: atHour(day, to), date: day, hours: Math.round((to - from) * 100) / 100 } }], 'Moved on the calendar');

  // Planned time whose end has passed: the owner says it happened (and it counts), or drops it.
  const due = wk.to_confirm ?? [];
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const confirmRow = (b) =>
    h(
      'li',
      { class: 'row-top' },
      h('a', { class: 'muted small tq-h', href: '#/time', title: 'Show its week', onclick: (ev) => (ev.preventDefault(), (timeState.from = mondayOf(b.date)), again()) }, dayName(b.date, { weekday: 'short', day: 'numeric' })),
      h('a', { class: 'gist grow', href: `#/e/${b.id}`, title: [b.what, b.work, b.start && `${clock(b.start)}\u2013${clock(b.end)}`].filter(Boolean).join('\n') }, b.what),
      h('span', { class: 'tq-h' }, hoursText(b.hours)),
      h('button', { title: 'It happened as planned: count it', onclick: async () => {
        const v = { work: { id: b.work_id }, what: b.what, date: b.date, start: b.start, end: b.end, hours: b.hours };
        write(b.routine ? await confirmRoutineOps(b, v, wk.types.entry) : [{ op: 'update', id: b.id, status: 'logged' }], 'Confirmed on the Time screen');
      } }, 'Confirm'),
      h('button', { title: 'Say what actually happened, then count it', onclick: async () => {
        const v = await happenedDialog(b);
        if (v) write(b.routine ? await confirmRoutineOps(b, v, wk.types.entry) : confirmEntryOps(b, v), 'Confirmed on the Time screen, as it happened');
      } }, 'Adjust'),
      menu('\u22ef', [['Drop', async () => {
        if (!b.routine) return write([{ op: 'archive', id: b.id }], 'Dropped on the Time screen: it did not happen');
        const p = (await api('get', { id: b.id })).entity.props;
        write([{ op: 'update', id: b.id, props: { skip: [...(Array.isArray(p.skip) ? p.skip : []), b.date] } }], `Skipped ${b.date} on the Time screen: it did not happen`);
      }, 'danger']]),
    );
  const confirm = due.length
    ? h(
        'section',
        { class: 'card tq-money' },
        h(
          'header',
          { class: 'tq-dayhead' },
          h('span', { class: 'grow' }, `To confirm ${due.length}`),
          due.length > 1 && h('button', { title: 'Every one happened as planned', onclick: async () => {
            const ops = due.filter((b) => !b.routine).map((b) => ({ op: 'update', id: b.id, status: 'logged' }));
            // The days of one routine are marked done together, each with its own entry.
            const byRoutine = Map.groupBy(due.filter((b) => b.routine), (b) => b.id);
            for (const [id, bs] of byRoutine) {
              const p = (await api('get', { id })).entity.props;
              bs.forEach((b, i) => ops.push({ op: 'create', ref: `e${id}${i}`, type: wk.types.entry, title: b.what, status: 'logged', props: { date: b.date, hours: b.hours, start: b.start, end: b.end } }, { op: 'link', type: 'part_of', from: `e${id}${i}`, to: b.work_id }));
              ops.push({ op: 'update', id, props: { done: [...(Array.isArray(p.done) ? p.done : []), ...bs.map((b) => b.date)] } });
            }
            write(ops, 'Confirmed on the Time screen');
          } }, 'Confirm all'),
        ),
        h('ul', { class: 'rows' }, due.map(confirmRow)),
      )
    : null;

  // What is owed: time not yet invoiced, by client; invoices sent and not paid; drafts.
  const inv = sheet.invoices;
  const draft = async (client) => {
    try {
      const made = await api('time_invoice_draft', { client: client.id });
      location.hash = `#/e/${made.created.inv}`;
    } catch (err) {
      tell('No invoice was drafted', err.message);
    }
  };
  const paid = async (i) => {
    const said = await ask({ title: `Payment on ${i.number}`, message: `${moneyText(i.owing, i.currency)} is owed. Give the amount received and how it came, e.g. "${i.owing} EFT". Left empty, the whole amount.`, input: { placeholder: `${i.owing} EFT` }, action: 'Record payment' });
    if (said === null) return;
    const amount = /^\s*\$?([\d,]+(?:\.\d+)?)/.exec(said)?.[1];
    const method = said.replace(/^\s*\$?[\d,]+(?:\.\d+)?\s*/, '').trim();
    try {
      await api('time_invoice_paid', { id: i.id, ...(amount && { amount: Number(amount.replaceAll(',', '')) }), ...(method && { method }) });
      (state.selfDrawn = true), again();
    } catch (err) {
      tell('The payment was not recorded', err.message);
    }
  };
  const block = (title, rows, empty) => h('section', { class: 'card tq-money' }, h('header', { class: 'tq-dayhead' }, h('span', { class: 'grow' }, title)), rows.length ? h('ul', { class: 'rows' }, rows) : h('div', { class: 'empty' }, empty));
  const money = h(
    'aside',
    { class: 'tq-side' },
    confirm,
    block(
      'Not invoiced',
      sheet.not_invoiced.map((c) =>
        h('li', { class: 'row-top' }, h('span', { class: 'gist grow', title: c.client }, c.client), h('span', { class: 'tq-h' }, hoursText(c.hours)), c.id ? h('button', { title: `Draft an invoice to ${c.client} for this time`, onclick: () => draft(c) }, 'Draft invoice') : h('span', { class: 'muted small', title: 'This time is for work that involves no company' }, 'no client')),
      ),
      'All billed.',
    ),
    block(
      `Owed ${moneyText(inv.owed_total)}`,
      inv.outstanding.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          h('a', { class: 'gist grow', href: `#/e/${i.id}`, title: `${i.number} to ${i.client}: ${moneyText(i.total, i.currency)}, ${moneyText(i.paid, i.currency)} paid` }, `${i.number} \u00b7 ${i.client}`),
          i.overdue_days ? h('span', { class: 'pill bad', title: `Due ${i.due}` }, `${i.overdue_days} d late`) : h('span', { class: 'muted small', title: 'Due' }, i.due ? dayName(i.due, { day: 'numeric', month: 'short' }) : ''),
          h('span', { class: 'tq-h' }, moneyText(i.owing, i.currency)),
          h('button', { onclick: () => paid(i) }, 'Mark paid'),
        ),
      ),
      'Nothing owed.',
    ),
    block(
      'Drafts',
      inv.drafts.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          h('a', { class: 'gist grow', href: `#/e/${i.id}`, title: `${i.number} to ${i.client}` }, `${i.number} \u00b7 ${i.client}`),
          h('span', { class: 'tq-h' }, moneyText(i.total, i.currency)),
          h('button', { title: 'Open it to print or save as a PDF', onclick: () => window.open(`/read/${i.id}`, '_blank') }, 'PDF'),
          h('button', { title: 'Mark it sent to the client', onclick: () => write([{ op: 'update', id: i.id, status: 'sent' }], `Marked ${i.number} sent on the Time screen`) }, 'Sent'),
        ),
      ),
      'No drafts.',
    ),
  );

  const thisWeek = from === mondayOf(today);
  const full = remember(CAL_FULL) === true;
  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Time'),
      h(
        'span',
        { class: 'switch' },
        h('button', { title: 'The week before', onclick: week(-1) }, '\u2039'),
        h('button', { class: 'on', title: `${from} to ${to}` }, `${dayName(from, { day: 'numeric', month: 'short' })} \u2013 ${dayName(to, { day: 'numeric', month: 'short' })}`),
        h('button', { title: 'The week after', onclick: week(1) }, '\u203a'),
      ),
      !thisWeek && h('button', { onclick: week(0) }, 'This week'),
      h(
        'button',
        {
          class: `${full ? 'on' : ''}${!full && calHidden(wk) ? ' cal-more' : ''}`,
          title: full ? 'Show weekdays, 06:00 to 22:00' : `Show the whole day and the weekend${calHidden(wk) ? ': there is more there this week' : ''}`,
          onclick: () => (remember(CAL_FULL, !full), again()),
        },
        'Full week',
      ),
      h('span', { class: 'fact', title: 'Hours this week' }, h('strong', {}, hoursText(sheet.total))),
    ),
    weekCalendar(wk, today, calendarActs, full),
    h('div', { class: 'tq-grid' }, h('div', { class: 'tq-main' }, add, days.length ? days : h('div', { class: 'empty card' }, 'Nothing logged this week.')), money),
  );
}
