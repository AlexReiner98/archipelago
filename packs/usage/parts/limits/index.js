// The Workspace page's Limits card, as the usage pack's part (slot workspace.card, in its People section): whether a
// limit the server sets is near, and how much of each is used. All of it is what the server was told by the pack that
// made the workspace; a workspace with no limit has no card. It is handed the usage view (items, one a limit with its
// use) and answers with marks alone.

/** The Workspace page's section this card stands in. */
const SECTION = 'people';

/** The limits the server sets this workspace: the usage view's limit items that have an allowance. */
export const limitsOf = (usage) => (usage?.items ?? []).filter((i) => i.use?.as === 'limit' && i.use.of !== undefined);

/** One limit's row: its name, and its use against what it allows, marked near or over. */
const row = (i) => {
  const u = i.use, tone = u.over ? 'bad' : u.near ? 'warn' : undefined;
  const said = `${u.shown} of ${u.of_shown ?? u.of}${u.over ? ': at the limit' : u.near ? ': near the limit' : ''}`;
  return ['box', { key: `l:${i.id}`, flow: 'row', gap: 4, align: 'between' },
    ['text', { look: 'muted' }, String(i.title).slice(0, 60)],
    ['text', { look: 'mark', tip: said, ...(tone && { tone }) }, `${u.shown} of ${u.of_shown ?? u.of}`],
  ];
};

export function limitsMarks(input) {
  const section = input?.piece?.section;
  if (section !== undefined && section !== SECTION) return ['box', {}];
  const limits = limitsOf(input?.views?.usage);
  if (!limits.length) return ['box', {}];
  const near = limits.filter((i) => i.use.near || i.use.over);
  const names = near.map((i) => i.title).join(', ');
  return ['box', { look: 'band', flow: 'column', gap: 4, pad: 6 },
    ['text', { look: 'title' }, 'Limits'],
    ['text', { look: near.length ? 'body' : 'muted', tip: near.length ? names.slice(0, 200) : 'Within every limit', ...(near.length && { tone: 'warn' }) }, near.length ? `near the limit: ${names}`.slice(0, 120) : 'within its limits'],
    ['list', { look: 'rows' }, ...limits.map(row)],
  ];
}

export default function limits(input) {
  let now = input;
  return {
    marks: limitsMarks(now),
    update(next) {
      now = next;
      return limitsMarks(now);
    },
  };
}
