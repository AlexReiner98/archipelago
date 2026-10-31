// The list: the drawing for a picture that is not a process. A table at the width it is given, one line a row: a
// thing's name, then its marks in columns that line up down the page (its status, who it waits on, whether it is
// blocked, whether a session is at it). A thing that holds others is a group header that folds, with its counts at
// the end of its line. Around one item, its neighbours are grouped under the link that ties each to it.

import { h } from './base.js';
import { BLOCKING, isOf } from './graph.js';
import { queryTree, litCount, litSwitch, sizeOf } from './query-base.js';
import { isClosed, relations, titles, typeTitle } from './words.js';

/** The columns a row may have, in the order they are drawn; a style's `show` picks among them. */
const COLUMNS = ['type', 'status', 'waits', 'sessions'];

/** The list: a table of one-line rows, grouped by what holds what. Reads only what a lens answers with. */
export function drawList(host, answer, style, keep, kept) {
  const { me, byId, root } = queryTree(answer);
  // `show` names columns; the older words for marks (you, blocked, count) mean the waits column.
  // Which columns and how far it opens are the style's: the house style says, and a nearer one may say otherwise.
  const asked = (Array.isArray(style.show) ? style.show : []).map((s) => (['you', 'blocked'].includes(s) ? 'waits' : s));
  const columns = COLUMNS.filter((c) => asked.includes(c));
  const levels = Number(style.open);
  const { opened } = kept;
  // Around one item, what it sits in is open down to it, and how far things open is counted from it.
  const here = byId.get(answer.lens.from);
  const above = new Set();
  for (let n = here?.up; n && n !== root; n = n.up) above.add(n.id);
  const base = here?.depth ?? 0;
  // What each thing waits on, by name: a person by their name, "you" for the one looking.
  const named = (id) => (id === me ? 'you' : (byId.get(id)?.title ?? titles.get(id) ?? 'someone'));
  const waits = new Map();
  for (const link of answer.links) if (isOf(BLOCKING, link.kind) && byId.has(link.to)) waits.set(link.from, [...(waits.get(link.from) ?? []), byId.get(link.to).title]);
  // What a session said ties a thing to another is written after its name: the list draws no lines.
  const ties = new Map();
  for (const link of answer.links) if (link.says && byId.has(link.to)) ties.set(link.from, [...(ties.get(link.from) ?? []), `${link.says} → ${byId.get(link.to).title}`]);
  const tied = (n) => ties.has(n.id) && h('span', { class: 'll-said', title: ties.get(n.id).join('\n') }, ties.get(n.id).join(' · '));
  const hint = (n) => `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.all > 1 ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : ''}${waits.has(n.id) ? `\nWaits on: ${waits.get(n.id).join('; ')}` : ''}${n.at ? '\nA session is at work here' : ''}`;
  const cell = (cls, ...kids) => h('span', { class: `ll-col ll-${cls}` }, ...kids);
  const cells = (n) =>
    columns.map((c) =>
      c === 'type'
        ? cell('type', typeTitle(n.type))
        : c === 'status'
          ? cell('status', h('span', { class: `pill${isClosed(n.type, n.status) ? ' closed' : ''}` }, n.status))
          : c === 'waits'
            ? cell(
                'waits',
                n.state.waits_on.length > 0 && h('span', { class: `ll-who${me && n.state.waits_on.includes(me) ? ' you' : ''}`, title: `Waits on ${n.state.waits_on.map(named).join(', ')}` }, n.state.waits_on.map(named).join(', ')),
                n.state.blocked && !n.state.waits_on.length && h('span', { class: 'll-blocked', title: waits.has(n.id) ? `Waits on: ${waits.get(n.id).join('; ')}` : 'Blocked' }, 'blocked'),
              )
            : cell('sessions', n.state.sessions > 0 && h('span', { class: 'll-at', title: 'A session is at work here' })),
    );
  // A group's line says what is in it: how many are open, blocked, and waiting on the one looking.
  const counts = (n) =>
    h(
      'span',
      { class: 'll-counts' },
      me && n.you > 0 && h('span', { class: 'll-n you', title: `${n.you} need you` }, String(n.you)),
      n.blk > 0 && h('span', { class: 'll-n blocked', title: `${n.blk} blocked` }, String(n.blk)),
      h('span', { class: 'll-n', title: `${n.work} open` }, String(n.work)),
    );
  const state = (n) => `${litCount(n, style) ? '' : ' dim'}${n.open ? '' : ' closed'}${n === here || n.id === style.here ? ' here' : ''}`;
  const indent = (depth) => `--ll-depth: ${depth}`;
  const rows = [];
  const add = (n, depth) => {
    if (n.all === 1 || !n.kids.length) {
      rows.push(
        h(
          'a',
          { class: `ll-row${state(n)}${n.state.blocked ? ' blocked' : ''}`, href: `#/e/${n.id}`, title: hint(n), style: indent(depth) },
          h('span', { class: 'll-name' }, h('span', { class: 'll-dot' }), h('span', { class: 'll-title' }, n.title), tied(n)),
          ...cells(n),
        ),
      );
      return;
    }
    const open = opened.get(n.id) ?? (above.has(n.id) || n.depth - base < levels);
    rows.push(
      h(
        'div',
        { class: `ll-row ll-group${state(n)}${open ? ' open' : ''}`, title: hint(n), style: indent(depth) },
        h(
          'span',
          { class: 'll-name' },
          h('button', { class: 'll-fold', title: open ? 'Close it' : 'Open it', onclick: () => (opened.set(n.id, !open), draw()) }, open ? '▾' : '▸'),
          h('a', { class: 'll-title', href: `#/e/${n.id}` }, n.title),
          tied(n),
          counts(n),
        ),
        ...cells(n),
      ),
    );
    // Within a group, its own rows first, then the groups inside it.
    if (open) for (const kid of [...n.kids.filter((k) => k.all === 1), ...n.kids.filter((k) => k.all > 1)]) add(kid, depth + 1);
  };
  // Around one item its neighbours are gathered under the link that ties each to it, said as that item would say it.
  const start = answer.lens.from;
  const said = (lane) => {
    const [kind, inward] = String(lane).split(':');
    const phrase = lane == null ? 'near it' : ((inward ? relations.get(kind)?.inverse : relations.get(kind)?.title) ?? kind);
    return phrase[0].toUpperCase() + phrase.slice(1);
  };
  const body = h('div', { class: 'll-table' });
  const draw = () => {
    rows.length = 0;
    const loose = start && answer.lens.lanes === 'link' ? root.kids.filter((n) => n.all === 1 && n.id !== start) : [];
    const lanes = new Map();
    for (const n of loose) lanes.set(n.lane ?? null, [...(lanes.get(n.lane ?? null) ?? []), n]);
    // The item the page is about is not drawn again as a row of its own.
    const top = root.kids.filter((n) => !loose.includes(n) && !(n.id === start && n.all === 1));
    for (const n of [...top.filter((k) => k.all === 1), ...top.filter((k) => k.all > 1)]) add(n, 0);
    for (const [lane, things] of lanes) {
      rows.push(h('div', { class: 'll-row ll-group ll-lane open', style: indent(0) }, h('span', { class: 'll-name' }, h('span', { class: 'll-title' }, said(lane)), h('span', { class: 'll-counts' }, h('span', { class: 'll-n' }, String(things.length))))));
      for (const n of things) add(n, 1);
    }
    body.style.setProperty('--ll-columns', String(columns.length));
    body.replaceChildren(...rows);
  };
  const lit = litSwitch(me, style, keep, draw);
  host.replaceChildren(...[lit && h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit), body].filter(Boolean));
  host.redraw = draw;
  // Narrow, the type and waits columns step aside, at the width the style says.
  new ResizeObserver(([seen]) => body.classList.toggle('ll-narrow', seen.contentRect.width < sizeOf(style, 'list_narrow_at'))).observe(body);
  draw();
}
