import { api, h, tell } from './base.js';
import { progressBar } from './roadmap.js';
import { chip, link, pill, unfolded } from './words.js';

// ---- Gate ----------------------------------------------------------------

// Which streams are unfolded, which unsorted items are ticked, and which gates show all of what is unsorted.
export const gateOpen = new Set();
export const gateTicked = new Set();
export const gateAll = new Set();

/**
 * An event as a gate, on the event's own page: what is not yet sorted (to be
 * put behind the gate or let follow), what holds it by stream, and what can
 * follow. Nothing, for an event that waits for nothing.
 */
export async function gate(eventId) {
  const main = document.getElementById('gate');
  if (main?.dataset.root !== eventId) return;
  const data = await api('view', { name: 'gate', params: { event: eventId } });
  if (!main.isConnected) return;
  const { counts } = data;
  if (!counts.holding && !counts.to_sort && !counts.can_follow && !data.proof) return main.replaceChildren();
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      gate(eventId);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const hold = (ids) => change(ids.map((id) => ({ op: 'link', type: 'depends_on', from: eventId, to: id })), 'Put behind the gate in the UI');
  const defer = (ids) => change(ids.map((id) => ({ op: 'link', type: 'defers', from: eventId, to: id })), 'Left to follow the event in the UI');
  /** From one side of the gate to the other. */
  const across = (x, to) => change([{ op: 'unlink', relation: x.relation }, { op: 'link', type: to, from: eventId, to: x.id }], to === 'defers' ? 'Left to follow the event in the UI' : 'Put behind the gate in the UI');
  const names = (list) => list.map((x) => x.title).join('\n');

  const unsorted = data.to_sort;
  for (const id of [...gateTicked]) if (!unsorted.some((x) => x.id === id)) gateTicked.delete(id);
  const chosen = () => (gateTicked.size ? unsorted.filter((x) => gateTicked.has(x.id)) : unsorted).map((x) => x.id);
  const holdAll = h('button', { title: 'The event waits for these', onclick: () => hold(chosen()) });
  const deferAll = h('button', { title: 'The event goes ahead without these', onclick: () => defer(chosen()) });
  const label = () => {
    const n = gateTicked.size;
    holdAll.textContent = n ? `${n} hold it` : 'All hold it';
    deferAll.textContent = n ? `${n} can follow` : 'All can follow';
  };
  label();
  const FIRST = 8;
  const whole = gateAll.has(eventId);
  const sortRow = (x) =>
    h(
      'li',
      { class: 'row-top' },
      h('input', { type: 'checkbox', title: 'Sort several at once', checked: gateTicked.has(x.id), onchange: (ev) => ((ev.target.checked ? gateTicked.add(x.id) : gateTicked.delete(x.id)), label()) }),
      chip(x.type),
      h('span', { class: 'grow', title: x.title }, link(x)),
      x.stream && h('span', { class: 'chip stream', title: `Part of ${x.stream.title}` }, x.stream.title),
      h('button', { title: 'The event waits for this', onclick: () => hold([x.id]) }, 'Holds it'),
      h('button', { title: 'The event goes ahead without this', onclick: () => defer([x.id]) }, 'Can follow'),
    );
  const heldRow = (x) =>
    h(
      'li',
      { class: 'row-top' },
      chip(x.type),
      h('span', { class: 'grow', title: x.title }, link(x)),
      x.yours && h('span', { class: 'pill warn', title: x.waiting_on.length ? `Waits on:\n${names(x.waiting_on)}` : 'Yours to answer' }, 'yours'),
      x.blocked && !x.yours && h('span', { class: 'pill bad', title: `Waits on:\n${names(x.waiting_on)}` }, 'blocked'),
      pill(x.type, x.status),
      x.relation && h('button', { class: 'quiet', title: 'The event goes ahead without this', onclick: () => across(x, 'defers') }, 'Can follow'),
    );
  // How we know: the questions asked of what this ships, answered or not on the build that is released.
  const asked = data.proof;
  const unanswered = asked ? asked.counts.questions - asked.counts.answered : 0;
  const proofRow =
    asked &&
    h(
      'li',
      {},
      h(
        'details',
        { open: gateOpen.has(`${eventId}:proof`), ontoggle: (ev) => (ev.target.open ? gateOpen.add(`${eventId}:proof`) : gateOpen.delete(`${eventId}:proof`)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow' }, 'How we know'),
          asked.build && h('span', { class: 'chip', title: asked.named ? 'The build this release names as its version' : 'The release names no version: this is the build last reported' }, asked.build),
          unanswered > 0 ? h('span', { class: 'pill warn' }, `${unanswered} unanswered`) : h('span', { class: 'pill ok' }, 'answered'),
          h('span', { class: 'progress', title: `${asked.counts.answered} of ${asked.counts.questions} questions answered` }, h('span', { class: 'bar' }, h('span', { style: `width: ${Math.round((asked.counts.answered / asked.counts.questions) * 100)}%` })), h('span', { class: 'muted small' }, `${asked.counts.answered}/${asked.counts.questions}`)),
        ),
        h(
          'ul',
          { class: 'rows work' },
          asked.questions.map((q) =>
            h('li', { class: 'row-top' }, chip(q.type), h('span', { class: 'grow', title: q.title }, link(q)), q.answered ? h('span', { class: 'pill ok' }, 'answered') : q.total ? h('span', { class: `pill ${q.failed ? 'bad' : 'warn'}` }, `${q.passed}/${q.total} passed`) : h('span', { class: 'pill closed' }, 'no tests')),
          ),
        ),
      ),
    );
  const stream = (s) => {
    const key = `${eventId}:${s.id}`;
    const open = s.items.filter((x) => !x.done);
    const closed = s.items.length - open.length;
    return h(
      'li',
      {},
      h(
        'details',
        { open: gateOpen.has(key), ontoggle: (ev) => (ev.target.open ? gateOpen.add(key) : gateOpen.delete(key)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow', title: s.title ?? '' }, s.id ? link(s) : h('span', { class: 'muted' }, 'On its own')),
          s.yours > 0 && h('span', { class: 'pill warn' }, `${s.yours} yours`),
          !open.length && h('span', { class: 'pill ok' }, 'clear'),
          progressBar(s.progress),
          s.relation && h('button', { class: 'quiet', title: 'The event goes ahead without all of this', onclick: (ev) => (ev.preventDefault(), across(s, 'defers')) }, 'Can follow'),
        ),
        h('ul', { class: 'rows work' }, open.map(heldRow), closed > 0 && h('li', { class: 'row-top muted small', title: names(s.items.filter((x) => x.done)) }, `${closed} done`)),
      ),
    );
  };

  main.replaceChildren(
    h(
      'div',
      { class: 'grid gated', style: 'margin-bottom: var(--space-8)' },
      unsorted.length > 0 &&
        h(
          'section',
          { class: 'card wide' },
          h('header', { class: 'bar' }, h('h2', { title: 'Open work under what this ships, not yet put behind the gate or left to follow' }, 'To sort'), h('span', { class: 'n' }, unsorted.length), h('span', { class: 'grow' }), holdAll, deferAll),
          h(
            'ul',
            { class: 'rows' },
            (whole ? unsorted : unsorted.slice(0, FIRST)).map(sortRow),
            unsorted.length > FIRST && h('li', { class: 'more' }, h('button', { class: 'quiet', onclick: () => ((whole ? gateAll.delete(eventId) : gateAll.add(eventId)), gate(eventId)) }, whole ? 'fewer' : `${unsorted.length - FIRST} more`)),
          ),
        ),
      (counts.holding > 0 || asked) &&
        h(
          'section',
          { class: 'card wide' },
          h(
            'header',
            { class: 'bar' },
            h('h2', { title: 'What the event waits for, by the feature or project it is part of' }, 'Holds it'),
            progressBar({ done: counts.holding - counts.open, total: counts.holding }),
            counts.open > 0 && h('span', { class: 'pill' }, `${counts.open} open`),
            counts.yours > 0 && h('span', { class: 'pill warn' }, `${counts.yours} yours`),
            unanswered > 0 && h('span', { class: 'pill warn', title: 'Proof questions not answered on the build' }, `${unanswered} unanswered`),
            data.clear && h('span', { class: 'pill ok' }, 'clear to go'),
          ),
          h('ul', { class: 'tree top' }, proofRow, data.streams.map(stream)),
        ),
      data.can_follow.length > 0 &&
        h(
          'details',
          { class: 'card wide fold', open: unfolded.get(`${eventId}:follow`) ?? false, ontoggle: (ev) => unfolded.set(`${eventId}:follow`, ev.target.open) },
          h('summary', {}, h('h2', { title: 'What the event goes ahead without' }, 'Can follow'), h('span', { class: 'n' }, data.can_follow.length)),
          h('ul', { class: 'rows' }, data.can_follow.map((x) => h('li', { class: `row-top${x.open ? '' : ' finished'}` }, chip(x.type), h('span', { class: 'grow', title: x.title }, link(x)), pill(x.type, x.status), h('button', { class: 'quiet', title: 'The event waits for this after all', onclick: () => across(x, 'depends_on') }, 'Holds it')))),
        ),
    ),
  );
}
