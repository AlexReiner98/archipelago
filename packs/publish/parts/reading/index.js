// A document read in its sheet as its reader meets it, as the publish pack's part (task e_9ybewb5f): its text, and in
// their places the sections it brings in, each a fold under its title with its picture (its view drawn as publishing
// keeps it, or its figure) and its note. It is handed the document read whole (the view `reading`, its pack's own)
// and how the item's style opens notes, and answers with marks alone: the host draws each picture out of what it handed.

import { section, named } from './sections.js';

/** The folds open at first: every one when the item's style opens notes (page.notes open or whole, handed as its piece's setting), else none. */
const opensAll = (input) => ['open', 'whole'].includes(input?.piece?.notes ?? input?.style?.page?.notes);

/** The marks for the document `d`; `open` holds the sections whose fold is open. */
export function marks(d, open) {
  if (!d || !Array.isArray(d.parts)) return ['text', { look: 'muted' }, 'This document cannot be read here'];
  const names = new Map([...d.parts.filter((p) => p.section).map((p) => [p.section.id, p.section.title]), ...Object.entries(d.links ?? {})]);
  const kids = d.parts.map((p, i) => (p.section ? section(p.section, { open: open.has(p.section.id), picture: Boolean(d.lenses?.[p.section.id] || p.section.picture), names }) : p.text ? ['note', { key: `text:${i}` }, named(p.text, names)] : null));
  return ['box', { flow: 'column', gap: 4 }, ...kids.filter(Boolean)];
}

export default function reading(input) {
  let now = input?.views?.reading;
  let open = new Set(opensAll(input) ? (now?.parts ?? []).filter((p) => p.section).map((p) => p.section.id) : []);
  const draw = () => marks(now, open);
  return {
    marks: draw(),
    update(next) {
      now = next?.views?.reading;
      return draw();
    },
    on(event) {
      const id = event?.name === 'press' && /^open:(e_[a-z0-9]{8})$/.exec(event.key ?? '')?.[1];
      if (!id) return undefined;
      open.has(id) ? open.delete(id) : open.add(id);
      return draw();
    },
  };
}
