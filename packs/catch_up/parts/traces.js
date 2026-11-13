// Traces: what was, until it is seen (task e_p3tygg6p). A change that reached the page from the log leaves a trace on
// each mark it touched, in its maker's hue (a session's word, which the runtime turns into its hue), until the person
// has seen it. The runtime watches the marks and says when one was in sight long enough (`seen`); this keeps what
// waits and what has been seen, and says the one line over a traced mark: who changed it, what it did, and why.
// Changes the person made here are not traced: they saw them made. Pure: no page, no clock but the one handed in.

import { gist, said, touched, whoSaid } from './changes.js';

/** The one line over a traced mark: who, what it did, and why. */
const lineOf = (t) => [`${t.who}, ${t.did.join(', ')}`, t.why].filter(Boolean).join(': ');

/** A fresh record: what waits to be seen by item id ({ key, who, did, why, word, at, line }), and what was seen by key, with when. */
export const traceBook = (kept) => ({
  waiting: new Map(Array.isArray(kept?.waiting) ? kept.waiting.filter((w) => Array.isArray(w) && !kept.seen?.[w[1]?.key]) : []),
  seen: kept?.seen && typeof kept.seen === 'object' ? { ...kept.seen } : {},
});

/** Trace what a change set touched, each in its maker's word, until it is seen. `me`: the person's actor. Answers whether anything changed. */
export function trace(book, set, me) {
  let moved = false;
  for (const [id, c] of touched(set)) {
    if (c.by?.actor && c.by.actor === me) continue;
    const key = `${id}@${c.pos}`;
    if (book.seen[key]) continue;
    // A later change by the same maker, not yet seen, adds to what its trace says; another's takes its place.
    const who = whoSaid(c.by);
    const was = book.waiting.get(id)?.who === who ? book.waiting.get(id) : undefined;
    const did = [...new Set([...(was?.did ?? []), said(c)])];
    const t = { key, who, did, why: gist(c.by?.reason) || was?.why, word: c.by?.word ?? null, at: c.at };
    book.waiting.set(id, { ...t, line: lineOf(t) });
    moved = true;
  }
  return moved;
}

/** The person has seen an item's trace (`now`, when): it waits no more. Answers whether it waited. */
export function sawIt(book, id, now) {
  const t = book.waiting.get(id);
  if (!t) return false;
  book.seen[t.key] = now;
  book.waiting.delete(id);
  return true;
}

/** What is kept between pages: seen keys are let go after `days`, since a key names a position never traced again once passed. */
export function keptOf(book, now, days) {
  for (const [k, at] of Object.entries(book.seen)) if (now - at > days * 864e5) delete book.seen[k];
  return { seen: book.seen, waiting: [...book.waiting] };
}

/** The trace marks, one for each item that waits: the runtime paints it on that item's marks on the canvas. */
export const traceMarks = (book) => [...book.waiting].map(([item, t]) => ['trace', { item, tip: t.line.slice(0, 200), ...(t.word && { word: t.word }) }]);
