// What the runtime hands the parts on its frame's slots, worked out with no page (tasks e_gaa2ubge, e_926g89jb,
// e_dswpuaft, e_rreguzes): which slots are handed the canvas's query and its answer, which answer a decision, which are
// shown only while a page state is set, the answer in brief and a lens with `said`. The page's side, which reads the
// canvas, is packs/surface/page/part-lens.js; packs/loader/kernel/slots.ts names the same slots (test/part-slots.test.ts keeps them alike).

import { filterSaid, namer } from './lens-terms.js';

/** The frame slots handed the canvas's query. */
export const QUERY_SLOTS = ['bar.find', 'bar.find.rows', 'canvas', 'traces', 'find'];
/** The slots handed the canvas's answer in brief too. */
export const ANSWER_SLOTS = ['bar.find', 'bar.find.rows'];
/** The slots whose part answers a decision, not marks. */
export const DECISION_SLOTS = ['tabs.land', 'tabs.life', 'ghosts'];
/** The slots whose part is told `away` when a press lands outside all of them, or another pane takes the focus. */
export const AWAY_SLOTS = ['find', 'bar.find', 'bar.find.rows'];
/** The slots handed the layouts the packs ship (`shapes`: { shape, title }), for a part that offers a layout. */
export const SHAPE_SLOTS = ['find'];
/** The slots handed the page's address (`page`) and told its history's steps, whose part may write the address (`go({ hash, push })`). */
export const PAGE_SLOTS = ['tabs'];
/** Slots drawn only while a page state another part publishes is set. */
export const SHOWN_WHILE = { 'bar.find.rows': 'find_open' };

/** How many items of an answer a part is handed in brief. */
const briefMost = 500;

/** The answer as a part is handed it: each item's id, type, status, the terms that found it or the step that reached it, its links, and whether it was cut. */
export function answerBrief(answer, { failed, limit } = {}) {
  const all = answer?.items ?? [];
  const items = all.slice(0, briefMost).map((i) => ({ id: i.id, type: i.type, ...(i.status && { status: i.status }), ...(i.terms && { terms: i.terms }), ...(i.step !== undefined && { step: i.step }) }));
  const links = (answer?.links ?? []).slice(0, briefMost * 2).map((r) => ({ id: r.id, type: r.type, from: r.from, to: r.to }));
  return { items, links, ...((answer?.cut || all.length > briefMost) && { cut: true }), ...(failed && { failed: String(failed).slice(0, 300) }), ...(limit && { limit }) };
}

/** A lens with `said`, the lens in a few words, in the schema's words and the names given. */
export const withSaid = (lens, words, names) => lens && { ...lens, said: filterSaid(lens.filter ?? {}, namer(words, names).termSaid) };
