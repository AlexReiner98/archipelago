// One line a finding, as marks: its claim (a press opens it), its value with its unit, and how old it is, from as of,
// each with its tip. A finding with a note has a press that shows it under the line, as a note (how it was found). A
// working finding carries Stand by in its menu, which marks it published: the island stands by it.

/** How long ago a day was: today, yesterday, a few days, then the date. */
export function age(asOf, now = Date.now()) {
  if (!asOf) return '—';
  const days = Math.round((now - new Date(`${asOf}T12:00`).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days} d` : String(asOf);
}

/** A finding's value as it reads: the value and its unit, or a dash when none is given. */
export const valueOf = (f) => (f.value === undefined || f.value === null ? '—' : `${f.value}${f.unit ? ` ${f.unit}` : ''}`).slice(0, 120);

/** What a tip says, cut to what a tip may hold. */
const tip = (said) => String(said).slice(0, 200);

/**
 * One finding's line, and its note under it when `open`. `standing` is the id of one whose stand is going out, drawn
 * as under way; `working` gives it the menu that stands by it.
 */
export function row(f, { working = false, standing, open = false } = {}) {
  const line = [
    'box',
    { key: `f:${f.id}`, flow: 'row', gap: 4, align: 'between' },
    ['box', { flow: 'row', gap: 3 },
      ...(f.body ? [['button', { key: `note:${f.id}`, look: 'quiet', tip: open ? 'Fold how it was found' : 'How it was found' }, open ? '▾' : '▸']] : []),
      ['text', { item: f.id, look: 'body', key: `t:${f.id}`, tip: tip(f.title ?? 'A finding') }, f.title ?? 'A finding'],
    ],
    ['box', { flow: 'row', gap: 4 },
      ['text', { look: 'muted', tip: tip(valueOf(f)) }, valueOf(f)],
      ['text', { look: 'muted', size: 2, ...(f.as_of && { tip: `As of ${f.as_of}` }) }, age(f.as_of)],
      ...(working
        ? [standing === f.id
            ? ['text', { look: 'mark', tone: 'muted', tip: 'Standing by it' }, '…']
            : ['menu', { key: `more:${f.id}`, label: '⋯', look: 'quiet', tip: 'More' }, ['button', { key: `stand:${f.id}`, tip: 'Mark it published: the island stands by it' }, 'Stand by']]]
        : []),
    ],
  ];
  return open && f.body ? ['box', { key: `r:${f.id}`, flow: 'column', gap: 2 }, line, ['note', { key: `n:${f.id}` }, f.body]] : line;
}
