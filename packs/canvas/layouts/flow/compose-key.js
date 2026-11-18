// The key of a flow picture (the page draws it, docs/layouts.md): what each mark it uses means, one to a row. The whole
// picture's key holds each outline by the types drawn in it, each phase's dot, a session's state, the two colours and
// each link type; an island's legend holds only its vocabulary, in its pack's words where it says its pack. Handed what
// ./index.js reads of the answer and the style (how a step stands, its colours), as functions. Layer: marks. Pure: what
// the picture draws in, rows of marks out.

import { lineageOf } from './graph.js';
import { m } from './marks.js';
import { ringKey } from './session-ring.js';
import { stateMark, STATES, STATE_WORDS } from './session.js';
import { shapedBy, shapeIn } from './steps.js';

/** The link type the order's wires are, for their colour. */
export const ORDER_TYPE = 'depends_on';
/** What the key calls the outline of each of core's starter types, and the order its rows go in. */
const KIND_WORDS = { work: 'Work', question: 'Question', occurrence: 'Event', record: 'Record', system: 'System', actor: 'Person', aim: 'Aim', place: 'Place' };
const KEY_ORDER = ['box', 'diamond', 'pill', 'sheet', 'ticket', 'cut', 'hexagon', 'flag', 'tab', 'end'];
/** What the key calls each phase, in its order; what only stands has no dot and no row. */
export const PHASE_WORDS = { not_started: 'Not started', under_way: 'Under way', finished: 'Finished', ended: 'Ended', trouble: 'Trouble' };
/** A link type as the key says it: its name without its pack, in words ("could_fund" is "Could fund"). */
const linkName = (type) => {
  const words = type.split('.').pop().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/** A name in words: "under_way" is "Under way". */
export const words = (name) => ((w) => w.charAt(0).toUpperCase() + w.slice(1))(String(name).replaceAll('_', ' '));

/**
 * The key's rows, for a picture. `at` is the picture's: `z` its sizes, `G` where a row's mark has its middle, how wide
 * and tall a step is in it and a dot's size, `corner` a step's corner, `story` whether it plays, `steps` a story's
 * steps, `shapes` how types are outlined, `sessions` the marks of a run's states, `shownAs` the places drawn as colours,
 * and `model()` the picture's model; how a step stands (stateOf, sessionOf, marked, markOf, heldUp, yours), its colours (kind,
 * onYou, placeClass), its ends (headless, endsOf), its dot (dot) and a step's outline (outline) are the picture's functions.
 */
export function keyOf(at) {
  const { z, G, corner: CORNER, story, steps, shapes, sessions, shownAs, model: current, stateOf, sessionOf, marked, markOf, heldUp, yours, kind, onYou, placeClass, headless, endsOf, dot, outline } = at;
  const mark = (inner, label) => ({ glyph: m('svg', { width: z('key_width'), height: z('key_height'), viewBox: '0 0 22 14' }, inner), label });
  const kindWord = (i) => ((t) => KIND_WORDS[t] ?? words(t))(shapedBy(i, shapes) ?? lineageOf(i).at(-1) ?? 'item');
  // A tie in a legend, as it is drawn: its line and its heads (the order's too, dashed where a choice is still open).
  const tieKey = (type, cls) => {
    const [stroke, d] = { end: ['M1 7H17', 'M21 7L13 3V11Z'], start: ['M5 7H21', 'M1 7L9 3V11Z'], both: ['M5 7H17', 'M1 7L9 3V11ZM21 7L13 3V11Z'] }[endsOf(type)];
    return m('g', {}, m('path', { d: stroke, class: `lf-tie${type === 'part_of' ? ' near' : ''}${headless.has(type) ? '' : ' headed'}${cls}` }), m('path', { d, class: `lf-head${cls}` }));
  };
  const orderKey = (dashed = false) => m('g', {}, m('path', { d: 'M1 7H17', class: `lf-wire${kind(ORDER_TYPE)}${dashed ? ' dashed' : ''}` }), m('path', { d: 'M21 7L13 3V11Z', class: `lf-head${kind(ORDER_TYPE)}` }));
  // A story's key has the phases its steps give too.
  const stepPhases = story ? steps.flatMap((s) => Object.values(s.fields ?? {}).map((f) => f?.phase).filter((p) => typeof p === 'string')) : [];
  const untilDecided = (st, model) => st.some((n) => !n.stub && model?.potential?.has(n.id)) && mark(m('g', { class: 'lf-step scenario' }, outline('box', G.x, G.y, G.w, G.h, CORNER)), 'Until decided');
  /**
   * The rows for what these steps and wires use: of the whole picture, or of one island (`local`). An island's legend
   * holds only its vocabulary, its types and link types (principle e_jxtawgq7: capabilities are a grammar every island
   * shares, so no legend explains them): the phase dot, a session's state, held up, waits on you, a finding crossing and
   * what is held for you leave it, each told in a tip on the mark itself.
   */
  const keyRows = ({ st, chains, ties, breaks, heldHere, model, local = false }) => {
    const drawnAs = new Map();
    for (const n of st) (drawnAs.get(n.shape) ?? drawnAs.set(n.shape, new Set()).get(n.shape)).add(n.stub ? 'Possible end' : kindWord(n.item));
    const uses = (test) => !local && st.some(test);
    const phases = new Set(local ? [] : [...st.filter((n) => !n.stub && (story || !marked(n.item))).map((n) => stateOf(n.item).phase), ...stepPhases].filter((p) => markOf(p) !== 'none'));
    return [
      [...drawnAs.keys()].sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)).map((shape) => mark(m('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, G.x, G.y, G.w, shape === 'diamond' ? G.h + 1 : G.h, CORNER, G.h / 3)), [...drawnAs.get(shape)].join(', '))),
      Object.keys(PHASE_WORDS).filter((p) => phases.has(p)).map((p) => mark(dot(`ph-${p} ${markOf(p)}${p === 'trouble' ? ' trouble' : ''}`, markOf(p), G.x, G.y, G.r), PHASE_WORDS[p])),
      !story && STATES.filter((s) => uses((n) => !n.stub && marked(n.item) && sessionOf(n.item).state === s)).map((s) => mark(stateMark(m, s, sessions.get(s), G.x, G.y, G.r), STATE_WORDS[s])),
      !local && !story && ringKey(st.filter((n) => !n.stub).map((n) => n.item), mark(m('g', { class: 'lf-step' }, m('g', { class: 'lf-sr' }, outline('box', G.x, G.y, G.w, G.h, CORNER))), 'A session on it')),
      uses((n) => !n.stub && heldUp(n.item)) && mark(dot('trouble hollow', 'hollow', G.x, G.y, G.r), 'Held up'),
      uses((n) => !n.stub && yours(n.item)) && mark(m('g', { class: 'lf-step you' }, outline('box', G.x, G.y, G.w, G.h, CORNER)), 'Waits on you'),
      shownAs.places.filter((p) => st.some((n) => !n.stub && shownAs.of.get(n.id) === p.id)).map((p) => mark(m('g', { class: `lf-step placed ${placeClass(p.hex)}` }, outline('box', G.x, G.y, G.w, G.h, CORNER)), p.within ? `${p.title}, in ${p.within}` : p.title)),
      untilDecided(st, model ?? current()),
      chains.length > 0 && mark(orderKey(), 'Leads to'),
      chains.some((c) => c.dashed) && mark(orderKey(true), 'If chosen'),
      breaks && mark(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
      // A tie of each type in the colour it is drawn in: its own, or that of what waits on you; "you" said only where both are drawn.
      ((rows) => rows.map((row) => {
        const [type, you] = row.split('\n'), cls = `${kind(type)}${you}`, both = rows.includes(`${type}\n`) && rows.includes(`${type}\n you`);
        return mark(tieKey(type, cls), you && both ? `${linkName(type)} you` : linkName(type));
      }))([...new Set(ties.map((t) => `${t.type}\n${local ? '' : onYou(t)}`))].sort()),
      !local && heldHere && mark(m('path', { d: 'M1 7H21', class: 'lf-wire held' }), 'Held for you'),
    ].flat().filter(Boolean);
  };
  // On an archipelago each island carries its own legend, inside it (the owner, 5 Nov 2026): its types and the link
  // types of its own wires. A link that leaves it is a finding crossing, of the shared grammar, told at its gates.
  // An island that says its pack (the answer's `islands`) names it in the pack's words and order, what is in use on it
  // (the owner, 6 Nov 2026), and the marks it draws besides: a step dashed until a choice is made, a possible end, the
  // order dashed where it follows an open choice (the owner, 18 Nov 2026: the legend said none of those).
  const packRows = (pack, group, st = group.model.all.filter((n) => !n.dummy)) => [
    ...pack.types.filter((t) => group.items.some((i) => i.type === t.id)).map((t) => ({ part: t.id, group: 'type', ...((shape) => mark(m('g', { class: 'lf-step' }, outline(shape, G.x, G.y, G.w, shape === 'diamond' ? G.h + 1 : G.h, CORNER, G.h / 3)), t.title))(shapeIn({ type: t.id, is: t.is, island: group.id }, shapes)) })),
    st.some((n) => n.stub) && { group: 'type', ...mark(m('g', { class: 'lf-step scenario' }, outline('end', G.x, G.y, G.w, G.h, CORNER, G.h / 3)), 'Possible end') },
    ((row) => row && { group: 'type', ...row })(untilDecided(st, group.model)),
    ...pack.links.filter((r) => group.links.some((l) => (l.type ?? l.kind) === r.id)).map((r) => ({ part: r.id, group: 'link', ...mark(r.id === ORDER_TYPE ? orderKey() : tieKey(r.id, kind(r.id)), r.title) })),
    group.model.chains.some((c) => c.dashed) && { group: 'link', ...mark(orderKey(true), 'If chosen') },
  ].filter(Boolean);
  return { keyRows, packRows };
}
