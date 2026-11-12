// An island's findings on its page, as the findings pack's part (task e_su88hwv7): what the island stands by
// (published) first, then its working findings, folded behind a press, each with a menu that marks it published
// (the pack's action findings.stand_by, sent through the host's bridge as the person's), and a press that shows how
// it was found. It is handed the island and its findings, each cut to the fields it reads (pack.json), and the
// schema's words (the finding type's name), and answers with marks alone.

import { row } from './rows.js';

/** The name the island's schema gives a finding, lower case, for a sentence. */
const named = (words) => (words?.types?.finding?.title ?? 'finding').toLowerCase();

/** The marks for what it was handed; `open` is whether the working findings are shown, `notes` whose notes are. */
function marks(input, open, standing, notes) {
  const all = input?.items ?? [];
  const published = all.filter((f) => f.published === true);
  const working = all.filter((f) => f.published !== true);
  const name = named(input?.words);
  if (!all.length) return ['text', { look: 'muted' }, `No ${name}s on this island yet`];
  return [
    'box',
    { flow: 'column', gap: 6 },
    published.length ? ['list', { look: 'rows' }, ...published.map((f) => row(f, { open: notes.has(f.id) }))] : ['text', { look: 'muted', size: 2 }, 'None marked published'],
    ...(working.length
      ? [
          ['button', { key: 'working', look: 'quiet', tip: `Working ${name}s: read on this island only, until it stands by them` }, `${open ? '▾' : '▸'} Working ${working.length}${input.more ? '+' : ''}`],
          ...(open ? [['list', { look: 'rows' }, ...working.map((f) => row(f, { working: true, standing, open: notes.has(f.id) }))]] : []),
        ]
      : []),
  ];
}

export default function findings(input, tools) {
  let now = input, open = false, standing;
  const notes = new Set();
  const draw = () => marks(now, open, standing, notes);
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
      const note = /^note:(e_[a-z0-9]{8})$/.exec(event.key ?? '')?.[1];
      if (note) return (notes.has(note) ? notes.delete(note) : notes.add(note), draw());
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
