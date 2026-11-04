// A run's turns along time, on its page: one row a turn (who started it, what it did as marks and counts, how it
// ended, its tokens), newest first, with the beats it told placed among them at their times (docs/sessions.md). The
// turns are the `turns` read; the beats are the `story` view.

import { api, h } from './base.js';
import { ago, gist, sessionWho, tokensText } from './words.js';

/** What a turn did, as marks: a glyph and a count each, what it counts in the tooltip. */
const MARKS = [
  ['edit', '✎', 'edits'],
  ['shell', '$', 'shell calls'],
  ['read', '◌', 'reads'],
  ['search', '⌕', 'searches'],
  ['map', '◇', 'map calls'],
  ['web', '⊕', 'web calls'],
  ['agent', '⑂', 'agents started'],
];

const mark = (glyph, n, tip, cls = '') => n > 0 && h('span', { class: `turn-mark${cls}`, title: `${n} ${tip}` }, `${glyph}${n}`);

/** Who started a turn: its person, the session that sent it (by name, a link to its page), or the event that did. */
function starter(t, names) {
  if (t.by === 'session' && t.from) {
    const run = names[t.from];
    return h('a', { href: `#/e/${t.from}`, class: 'turn-who' }, sessionWho(run?.name ? `Session ${run.name} · ${run.title}` : (run?.title ?? 'A session'), 'Started this turn'));
  }
  if (t.by === 'event') return h('span', { class: 'who who-agent turn-who', title: 'Started by an event' }, t.from ?? 'Event');
  return h('span', { class: 'who who-human turn-who', title: 'A person’s prompt' }, 'You');
}

/** A question's first clause: up to its first question mark, or as a reason's gist is cut. */
const clause = (q) => gist((q ?? '').split(/(?<=\?)\s/)[0]);

/** How a turn ended: the question it asked as its first clause, or a word; an open one is under way. */
function ending(t) {
  if (!t.end) return h('span', { class: 'turn-end muted', title: 'Under way' }, '…');
  if (t.end === 'asked') return h('span', { class: 'turn-end turn-asked', title: t.question ?? 'Asked' }, clause(t.question) || '?');
  if (t.end === 'done') return h('span', { class: 'turn-end muted', title: t.reply ?? 'Done' }, '✓');
  return h('span', { class: `turn-end${t.end === 'failed' ? ' bad' : ' muted'}`, title: t.end }, t.end);
}

const total = (tokens) => (tokens ? (tokens.input ?? 0) + (tokens.output ?? 0) : 0);

function turnRow(t, names) {
  const used = total(t.tokens);
  const said = t.gist ?? t.reply ?? '';
  return h(
    'li',
    { class: `beat turn${t.end ? '' : ' open'}` },
    h(
      'details',
      {},
      h(
        'summary',
        { title: said },
        starter(t, names),
        h('span', { class: 'said' }, said || h('span', { class: 'muted' }, 'A turn')),
        h(
          'span',
          { class: 'turn-marks' },
          MARKS.map(([tool, glyph, tip]) => mark(glyph, t.tools?.[tool] ?? 0, tip)),
          mark('✓', t.tests?.ok ?? 0, 'test runs passed', ' ok'),
          mark('✗', t.tests?.failed ?? 0, 'test runs failed', ' bad'),
          mark('●', t.commits?.length ?? 0, 'commits'),
          mark('◆', t.items?.length ?? 0, 'items read or changed'),
        ),
        ending(t),
        used > 0 && h('span', { class: 'turn-tokens muted', title: `${used} tokens in and out` }, tokensText(used)),
        ago(t.began),
      ),
      h(
        'div',
        { class: 'beat-more' },
        t.gist && h('p', {}, t.gist),
        t.question && h('p', { class: 'turn-asked' }, t.question),
        t.reply && h('p', { class: 'muted' }, t.reply),
        t.files?.length > 0 && h('p', { class: 'muted small turn-files', title: t.files.join('\n') }, t.files.join(' · ')),
      ),
    ),
  );
}

function beatRow(b) {
  return h(
    'li',
    { class: `beat told${b.replaced_by ? ' taken-back' : ''}${b.finding ? ' found' : ''}` },
    h('details', {}, h('summary', { title: b.said }, h('span', { class: 'n', title: 'A beat the session told' }, b.n), h('span', { class: 'said' }, b.said), ago(b.at)), h('div', { class: 'beat-more' }, h('p', {}, b.said))),
  );
}

/** The run's turns and beats along time, in place of `host`: a section of its page, once there is anything to show. */
export async function turnsPiece(host, run, section) {
  const [answer, story] = await Promise.all([api('view', { name: 'turns', params: { run: run.id } }), api('view', { name: 'story', params: { run: run.id } }).catch(() => null)]);
  const turns = answer?.turns ?? [];
  const beats = story?.beats ?? [];
  if (!turns.length && !beats.length) return host.remove();
  const rows = [...turns.map((t) => ({ at: t.began, row: () => turnRow(t, answer.names ?? {}) })), ...beats.map((b) => ({ at: b.at, row: () => beatRow(b) }))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const count = `${turns.length + (answer.more ?? 0)}`;
  host.replaceWith(section('turns', 'Turns', count, h('ol', { class: 'beats turns' }, rows.map((r) => r.row()), answer.more > 0 && h('li', { class: 'muted small turn-more' }, `${answer.more} older`))));
}
