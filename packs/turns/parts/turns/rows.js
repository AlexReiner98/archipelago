// One line a turn, and one a beat, as marks. A turn reads as who started it, what it was about, what it did as marks
// and counts, how it ended, its tokens and how long ago; a press on it folds it open, and an open one carries the press
// that follows it up. A beat is its number, what the session told, and how long ago.

/** What a turn did, as marks: the tool kind it counts, its glyph, and what it counts in words. */
export const MARKS = [
  ['edit', '✎', 'edits'],
  ['shell', '$', 'shell calls'],
  ['read', '◌', 'reads'],
  ['search', '⌕', 'searches'],
  ['map', '◇', 'map calls'],
  ['web', '⊕', 'web calls'],
  ['agent', '⑂', 'agents started'],
];

/** How long ago a time was, in a few letters: now, minutes, hours, yesterday, then days. */
export function ago(at, now = Date.now()) {
  const then = Date.parse(at ?? '');
  if (Number.isNaN(then)) return '—';
  const mins = Math.floor((now - then) / 60_000);
  return mins < 1 ? 'now' : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h` : mins < 2880 ? 'yesterday' : `${Math.floor(mins / 1440)} d`;
}

/** Tokens in a few letters: 950, 12k, 1.2M. */
export const tokensText = (t) => (t >= 1e6 ? `${+(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : `${Math.round(t)}`);

/** The first clause of what was said: up to its first stop, cut to a line. */
export const clause = (s) => String(s ?? '').trim().split(/(?<=[?.!])\s|\n/)[0].slice(0, 160);

/** A turn's key, by its start: stable while turns come and go above it. */
export const turnKey = (t) => `turn:${String(t.began ?? '').replace(/[^A-Za-z0-9_:.-]/g, '')}`.slice(0, 70);

/** What a turn leaves to follow up: its question, else what it was about. */
export const toFollow = (t) => (t.end === 'asked' && t.question) || t.gist || t.reply || '';

/** Who started a turn: a session (an item mark, so a press opens its page), an event, or the person. */
function starter(t, names) {
  if (t.by === 'session' && t.from) {
    const run = names?.[t.from];
    // A session the map holds is an item mark (a press opens its page); one it does not, its words alone.
    const item = /^e_[a-z0-9]{8}$/.test(t.from) ? { item: t.from, key: `who:${turnKey(t)}` } : {};
    return ['text', { ...item, look: 'mark', tone: 'accent' }, run?.name ? `Session ${run.name}` : (run?.title ?? 'A session').slice(0, 40)];
  }
  if (t.by === 'event') return ['text', { look: 'mark', tone: 'muted' }, String(t.from ?? 'Event').slice(0, 40)];
  return ['text', { look: 'mark', tone: 'accent' }, 'You'];
}

/** How a turn ended: the first clause of its question, a tick, a word; an open one is under way. */
function ending(t) {
  if (!t.end) return ['text', { look: 'muted' }, '…'];
  if (t.end === 'asked') return ['text', { tone: 'accent' }, clause(t.question) || '?'];
  if (t.end === 'done') return ['text', { look: 'muted' }, '✓'];
  return ['text', { tone: t.end === 'failed' ? 'bad' : 'muted' }, String(t.end).slice(0, 40)];
}

const count = (glyph, n, tone) => (n > 0 ? [['text', { look: 'mark', ...(tone && { tone }) }, `${glyph}${n}`]] : []);

/** One turn's line, and when it is open, what it said in full and the press that follows it up. */
export function turnRow(t, { names, open = false, following, followed, now } = {}) {
  const key = turnKey(t);
  const used = (t.tokens?.input ?? 0) + (t.tokens?.output ?? 0);
  const said = t.gist ?? t.reply ?? '';
  const line = [
    'box',
    { flow: 'row', gap: 5 },
    ['button', { key, look: 'quiet', label: open ? 'Fold this turn' : 'What this turn said' }, open ? '▾' : '▸'],
    starter(t, names),
    ['box', { flow: 'row', grow: true }, ['text', { look: said ? 'body' : 'muted' }, said ? clause(said) : 'A turn']],
    ['box', { flow: 'row', gap: 4 },
      ...MARKS.flatMap(([tool, glyph]) => count(glyph, t.tools?.[tool] ?? 0)),
      ...count('✓', t.tests?.ok ?? 0, 'ok'),
      ...count('✗', t.tests?.failed ?? 0, 'bad'),
      ...count('●', t.commits?.length ?? 0),
      ...count('◆', t.items?.length ?? 0),
    ],
    t.end === 'asked' ? ['box', { flow: 'row', grow: true }, ending(t)] : ending(t),
    ...(used > 0 ? [['text', { look: 'muted', size: 2 }, tokensText(used)]] : []),
    ['text', { look: 'muted', size: 2 }, ago(t.began, now)],
  ];
  if (!open) return line;
  const follow = toFollow(t);
  return [
    'box',
    { flow: 'column', gap: 3 },
    line,
    ['box', { flow: 'column', gap: 3, pad: 4 },
      ...(t.gist ? [['text', { look: 'body' }, t.gist.slice(0, 600)]] : []),
      ...(t.question ? [['text', { tone: 'accent' }, t.question.slice(0, 600)]] : []),
      ...(t.reply ? [['text', { look: 'muted' }, t.reply.slice(0, 600)]] : []),
      ...(t.files?.length ? [['text', { look: 'muted', size: 2 }, t.files.slice(0, 20).join(' · ')]] : []),
      ...(follow
        ? [following === key
            ? ['text', { look: 'muted' }, '…']
            : followed?.[key]?.said
              ? ['text', { look: 'muted', tone: 'ok' }, `Followed up: ${followed[key].said}`]
              : ['box', { flow: 'row', gap: 4 },
                  ['button', { key: `follow:${key}`, look: 'quiet', label: 'Make a task of this turn, about this session' }, followed?.[key]?.error ? 'Try again' : 'Follow up'],
                  ...(followed?.[key]?.error ? [['text', { tone: 'bad', size: 2 }, `Not sent: ${followed[key].error.slice(0, 160)}`]] : [])]]
        : []),
    ],
  ];
}

/** One beat's line: its number, what was told (struck through when taken back), how long ago. */
export function beatRow(b, now) {
  return [
    'box',
    { flow: 'row', gap: 5 },
    ['text', { look: 'muted', size: 2 }, String(b.n ?? '')],
    ['box', { flow: 'row', grow: true }, ['text', { look: b.replaced_by ? 'muted' : 'body', ...(b.finding && !b.replaced_by && { bold: true }) }, clause(b.said) || 'A beat']],
    ['text', { look: 'muted', size: 2 }, ago(b.at, now)],
  ];
}
