// One section of a document as marks: a fold under its title (a press opens it), and in it the section's picture and
// its note. A bare id in a note that names a section or a linked document is written as its name, in the dialect.

/** What a tip may hold. */
const tip = (said) => String(said).slice(0, 200);

/** `text` with each bare id `names` knows written as [its name](id), so the note reads names, not identifiers. */
export function named(text, names) {
  return String(text ?? '').replace(/(\[[^\]]*\]\()?\b(e_[a-z0-9]{8})\b/g, (whole, linked, id) => (linked || !names.has(id) ? whole : `[${String(names.get(id)).replace(/[[\]]/g, '')}](${id})`));
}

/** A section's fold: open, it holds its picture when it has one (`picture`) and its note. */
export function section(s, { open = false, picture = false, names = new Map() } = {}) {
  const title = s.title ?? 'A section';
  return [
    'box',
    { key: `s:${s.id}`, flow: 'column', gap: 2 },
    ['box', { flow: 'row' }, ['button', { key: `open:${s.id}`, look: 'quiet', tip: tip(open ? `Fold ${title}` : title) }, `${open ? '▾' : '▸'} ${title}`]],
    ...(open && picture ? [['picture', { key: `p:${s.id}`, item: s.id }]] : []),
    ...(open && s.body ? [['note', { key: `n:${s.id}` }, named(s.body, names)]] : []),
  ];
}
