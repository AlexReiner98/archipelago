// One line a finding, as marks: its claim (a press opens it), its value with its unit, and how old it is, from as of.
// A working finding carries a press that marks it published: the island stands by it.

/** How long ago a day was: today, yesterday, a few days, then the date. */
export function age(asOf, now = Date.now()) {
  if (!asOf) return '—';
  const days = Math.round((now - new Date(`${asOf}T12:00`).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days} d` : String(asOf);
}

/** A finding's value as it reads: the value and its unit, or a dash when none is given. */
export const valueOf = (f) => (f.value === undefined || f.value === null ? '—' : `${f.value}${f.unit ? ` ${f.unit}` : ''}`).slice(0, 120);

/** One finding's line; `standing` is the id of one whose stand is going out, drawn as under way. */
export function row(f, { working = false, standing } = {}) {
  return [
    'box',
    { key: `f:${f.id}`, flow: 'row', gap: 4, align: 'between' },
    ['text', { item: f.id, look: 'body', key: `t:${f.id}` }, f.title ?? 'A finding'],
    ['box', { flow: 'row', gap: 4 },
      ['text', { look: 'muted' }, valueOf(f)],
      ['text', { look: 'muted', size: 2 }, age(f.as_of)],
      ...(working ? [standing === f.id ? ['text', { look: 'mark', tone: 'muted' }, '…'] : ['button', { key: `stand:${f.id}`, look: 'quiet', label: 'Stand by this finding: mark it published' }, 'Stand by']] : []),
    ],
  ];
}
