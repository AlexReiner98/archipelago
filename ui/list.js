// The list: the drawing for a picture that is not a process. Each thing is one line; a thing that holds others is a
// titled box that folds, with what is inside it in it. Around one item, its neighbours are gathered under the link
// that ties each to it.

import { h } from './base.js';
import { BLOCKING, isOf } from './graph.js';
import { lensTree, litCount, litSwitch } from './lens-base.js';
import { relations, typeTitle } from './words.js';

/** The list: a thing is a titled box, what is inside it is in it, and a thing with nothing inside is one line. Reads only what a lens answers with. */
export function drawList(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const show = new Set(Array.isArray(style.show) ? style.show : ['you', 'blocked', 'count']);
  const levels = Number.isFinite(style.open) ? style.open : 1;
  const { opened } = kept;
  // Around one item, what it sits in is open down to it, and how far things open is counted from it.
  const here = byId.get(answer.lens.from);
  const above = new Set();
  for (let n = here?.up; n && n !== root; n = n.up) above.add(n.id);
  const base = here?.depth ?? 0;
  // What each thing waits on, by name, for its tooltip.
  const waits = new Map();
  for (const link of answer.links) if (isOf(BLOCKING, link.kind) && byId.has(link.to)) waits.set(link.from, [...(waits.get(link.from) ?? []), byId.get(link.to).title]);
  // What a session said ties a thing to another is written on its line, after its name: boxes draw no lines.
  const ties = new Map();
  for (const link of answer.links) if (link.says && byId.has(link.to)) ties.set(link.from, [...(ties.get(link.from) ?? []), `${link.says} → ${byId.get(link.to).title}`]);
  const tied = (n) => ties.has(n.id) && h('span', { class: 'lb-said', title: ties.get(n.id).join('\n') }, ties.get(n.id).join(' · '));
  const body = h('div', { class: 'lb-top' });
  const count = (n) => litCount(n, style);
  const hint = (n) => `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.all > 1 ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : n.state.blocked ? ', blocked' : ''}${waits.has(n.id) ? `\nWaits on: ${waits.get(n.id).join('; ')}` : ''}${n.at ? '\nA session is at work here' : ''}`;
  const mark = (cls, text, title) => h('span', { class: `lb-mark lb-${cls}`, title }, text);
  const marks = (n) => [
    show.has('you') && n.you > 0 && mark('you', n.all > 1 ? String(n.you) : '', n.all > 1 ? `${n.you} need you` : 'Waits on you'),
    show.has('blocked') && n.blk > 0 && mark('blocked', n.all > 1 ? String(n.blk) : '', n.all > 1 ? `${n.blk} blocked` : 'Blocked'),
    show.has('sessions') && n.at > 0 && mark('at', '', 'A session is at work here'),
    show.has('count') && n.all > 1 && mark('count', String(n.work), `${n.work} open`),
    show.has('type') && mark('word', typeTitle(n.type), 'What kind of thing it is'),
    show.has('status') && mark('word', n.status, 'Its status'),
  ];
  const thing = (n) => {
    const state = `${count(n) ? '' : ' dim'}${n.open ? '' : ' closed'}${n.state.blocked ? ' blocked' : ''}${me && n.state.waits_on.includes(me) ? ' you' : ''}${n === here || n.id === style.here ? ' here' : ''}`;
    if (n.all === 1) return h('a', { class: `lb-leaf${state}`, href: `#/e/${n.id}`, title: hint(n) }, h('span', { class: 'lb-dot' }), h('span', { class: 'lb-name' }, n.title), tied(n), ...marks(n).slice(2));
    const open = n.kids.length > 0 && (opened.get(n.id) ?? (above.has(n.id) || n.depth - base < levels));
    const leaves = n.kids.filter((kid) => kid.all === 1);
    const boxes = n.kids.filter((kid) => kid.all > 1);
    return h(
      'section',
      { class: `lb-box${state}${open ? ' open' : ''}${n.depth % 2 ? ' odd' : ''}` },
      h(
        'header',
        { title: hint(n) },
        n.kids.length > 0 && h('button', { class: 'lb-fold', title: open ? 'Close it' : 'Open it', onclick: () => (opened.set(n.id, !open), draw()) }, open ? '▾' : '▸'),
        h('a', { class: 'lb-name', href: `#/e/${n.id}` }, n.title),
        tied(n),
        ...marks(n),
      ),
      open && leaves.length > 0 && h('div', { class: 'lb-leaves' }, leaves.map(thing)),
      open && boxes.length > 0 && h('div', { class: 'lb-kids' }, boxes.map(thing)),
    );
  };
  // Around one item its neighbours are gathered under the link that ties each to it, said as that item would say it.
  const start = answer.lens.from;
  const said = (lane) => {
    const [kind, inward] = String(lane).split(':');
    const phrase = lane == null ? 'near it' : ((inward ? relations.get(kind)?.inverse : relations.get(kind)?.title) ?? kind);
    return phrase[0].toUpperCase() + phrase.slice(1);
  };
  const draw = () => {
    const loose = start && answer.lens.lanes === 'link' ? root.kids.filter((n) => n.all === 1 && n.id !== start) : [];
    const lanes = new Map();
    for (const n of loose) lanes.set(n.lane ?? null, [...(lanes.get(n.lane ?? null) ?? []), n]);
    body.replaceChildren(
      // The item the page is about is not drawn again as a line of its own.
      ...root.kids.filter((n) => !loose.includes(n) && !(n.id === start && n.all === 1)).map(thing),
      ...[...lanes].map(([lane, things]) => h('section', { class: 'lb-box lane' }, h('header', {}, h('span', { class: 'lb-name' }, said(lane)), h('span', { class: 'lb-mark lb-count' }, String(things.length))), h('div', { class: 'lb-leaves' }, things.map(thing)))),
    );
  };
  const lit = litSwitch(me, style, keep, draw);
  host.replaceChildren(...[lit && h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit), body].filter(Boolean));
  host.redraw = draw;
  draw();
}
