// One row a style preset, as marks: its name (the owner's version of it opens with a press), what it is on, and the
// one thing to do with it: Change keeps the owner's version on the map, as the preset is, to change; Use again brings
// a retired one back; one already the owner's is marked yours.

/** What a type is called on this map, by its words. */
export const typeTitle = (words, t) => words?.types?.[t]?.title ?? t;

/** What a preset is for: the whole workspace, or the types it is on. */
export const where = (s, words) => (s.on?.length ? `on ${s.on.map((t) => typeTitle(words, t)).join(', ')}` : 'the whole workspace');

/** A preset is a theme when it is used only once chosen. */
export const isTheme = (s) => s?.over === 'chosen';

/** One preset's row; `busy` is the id of the one whose change is going out. */
export function presetRow(s, words, busy) {
  const name = String(s.title ?? s.id).slice(0, 60);
  const act = busy === s.id
    ? ['text', { look: 'mark', tone: 'muted', tip: 'Going out' }, '…']
    : s.retired
      ? ['button', { key: `again:${s.id}`, tip: `Use ${name} again` }, 'Use again']
      : s.item
        ? ['text', { look: 'mark', tip: 'You changed this preset: open it to change it again' }, 'yours']
        : ['button', { key: `change:${s.id}`, tip: 'Keep your own version of it on the map, to change' }, 'Change'];
  return ['box', { key: `p:${s.id}`, flow: 'row', gap: 4, align: 'between' },
    ['box', { flow: 'row', gap: 3 },
      ['text', { look: 'body', bold: true, tip: `${name}, a style: ${where(s, words)}`, ...(s.item && { item: s.item }) }, name],
      ['text', { look: 'muted', size: 2 }, s.retired ? 'not used' : where(s, words)],
    ],
    act,
  ];
}
