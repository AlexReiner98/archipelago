// A grid told as it fills: a lens's steps over the grid's own picture (index.js). The grid is laid out once, whole,
// from every step the story ever brings in, so nothing moves; each step shows the cards it brings, in the accent a
// while, with their row and their lane's head, and takes away what it takes away. The conversation beside it and the
// chapters above it are play.js's, shared with the other drawings' stories.

import { accent, inFrame as on } from './play.js';
import { css as storyLook } from './story-look.js';

export { everyNamed, present as statesOf } from './play.js';

/** How a story's marks look besides the grid's own: what is not in yet, and what comes in. */
export const css = `${storyLook}
.lf-beside > .lg-stage { flex: 3 1 0; min-width: var(--side-least); }
.lg-card, .lg-row, .lg-lane { transition: opacity 0.6s, border-color 0.8s, box-shadow 0.8s; }
.lg-card.sp-off, .lg-row.sp-off, .lg-lane.sp-off { opacity: 0; }
.lg-cell { transition: border-color 0.6s; }
.lg-row.sp-off, .lg-cell.sp-off { border-top-color: transparent; }
.lg-card.sp-new { border-color: var(--accent); box-shadow: 0 0 0 var(--border-2) var(--accent); }
.lg-row.sp-new { color: var(--accent); }
`;

/**
 * The grid's stage for play.js: `apply(k, dur)` shows step k. `marks` says what the picture drew: each card's key, the
 * item it is of and its lane (`cards`), each row's key, its cells' and the items in it (`rows`), and each lane head's (`lanes`).
 */
export function reveal({ frames, marks, t, send, later }) {
  let was = null;
  return {
    away: () => false,
    apply(k, dur) {
      const f = frames[k], list = [], fresh = [];
      const show = (key, now, then) => {
        list.push({ key, toggle: { 'sp-off': !now } });
        if (now && !then && dur) fresh.push(key);
      };
      for (const c of marks.cards) show(c.key, on(c.ids, f), on(c.ids, was));
      // A row comes in with its rules, and its head in the accent.
      for (const r of marks.rows) (show(r.key, on(r.ids, f), on(r.ids, was)), list.push(...r.cells.map((key) => ({ key, toggle: { 'sp-off': !on(r.ids, f) } }))));
      // A lane's head is in once a card in it is.
      const lanes = (frame) => new Set(marks.cards.filter((c) => on(c.ids, frame)).map((c) => c.lane));
      const [now, then] = [lanes(f), lanes(was)];
      for (const l of marks.lanes) show(l.key, now.has(l.value), then.has(l.value));
      accent(fresh, list, { t, send, later });
      send(list);
      was = f;
    },
  };
}
