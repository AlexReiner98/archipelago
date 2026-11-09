// A plan told as it comes together: a lens's steps over the time drawing's own picture (index.js). The days are laid
// out once, from every step the story ever brings in, so nothing moves; each step shows the blocks it brings, in the
// accent a while, and takes away what it takes away. The conversation beside it and the chapters above it are
// play.js's, shared with the other drawings' stories.

import { accent, inFrame as on } from './play.js';
import { css as storyLook } from './story-look.js';

export { everyNamed, present as statesOf } from './play.js';

/** How a story's marks look besides the time drawing's own: what comes in. */
export const css = `${storyLook}
.lf-beside > svg.timeline { flex: 3 1 0; min-width: var(--side-least); max-width: 100%; height: auto; }
.t-block .dot { transition: stroke 0.8s, stroke-width 0.8s; }
.t-block.sp-new .dot { stroke: var(--accent); stroke-width: var(--border-3); }
`;

/** The time drawing's stage for play.js: `apply(k, dur)` shows step k. `marks` is each mark's key and the items it is of. */
export function reveal({ frames, marks, t, send, later }) {
  let was = null;
  return {
    away: () => false,
    apply(k, dur) {
      const f = frames[k], list = [], fresh = [];
      for (const { key, ids } of marks) {
        const now = on(ids, f);
        list.push({ key, toggle: { 'sp-off': !now }, set: { opacity: now ? 1 : 0 }, ...(dur && { over: dur }) });
        if (now && !on(ids, was) && dur) fresh.push(key);
      }
      accent(fresh, list, { t, send, later });
      send(list);
      was = f;
    },
  };
}
