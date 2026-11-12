// An island's findings on its page, as the findings pack's part (task e_su88hwv7): what the island stands by
// (published) first, then its working findings, folded behind a press, each with a press that marks it published
// (the pack's action findings.stand_by, sent through the host's bridge as the person's). It is handed the island and
// its findings, each cut to the fields it reads (pack.json), and answers with marks alone.

import { row } from './rows.js';

/** The marks for what it was handed; `open` is whether the working findings are shown. */
function marks(input, open, standing) {
  const all = input?.items ?? [];
  const published = all.filter((f) => f.published === true);
  const working = all.filter((f) => f.published !== true);
  if (!all.length) return ['text', { look: 'muted' }, 'No findings on this island yet'];
  return [
    'box',
    { flow: 'column', gap: 6 },
    published.length ? ['list', { look: 'rows' }, ...published.map((f) => row(f))] : ['text', { look: 'muted', size: 2 }, 'None marked published'],
    ...(working.length
      ? [
          ['button', { key: 'working', look: 'quiet', label: 'Working findings: read on this island only, until it stands by them' }, `${open ? '▾' : '▸'} Working ${working.length}${input.more ? '+' : ''}`],
          ...(open ? [['list', { look: 'rows' }, ...working.map((f) => row(f, { working: true, standing }))]] : []),
        ]
      : []),
  ];
}

export default function findings(input, tools) {
  let now = input, open = false, standing;
  const draw = () => marks(now, open, standing);
  return {
    marks: draw(),
    update(next) {
      now = next;
      standing = undefined;
      return draw();
    },
    async on(event) {
      if (event?.name !== 'press') return undefined;
      if (event.key === 'working') return ((open = !open), draw());
      const id = /^stand:(e_[a-z0-9]{8})$/.exec(event.key ?? '')?.[1];
      if (!id) return undefined;
      standing = id;
      tools.marks(draw());
      const said = await tools.act('findings.stand_by', { finding: id });
      if (said?.error) standing = undefined;
      return draw();
    },
  };
}
