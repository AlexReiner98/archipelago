// A process told as it happens: a lens's steps over the flow's own picture (index.js). The process is laid out once,
// whole, from every step the story ever brings in, so nothing moves; each step of the story shows what it brings, in
// the accent a while, its wires drawn in once both their ends are there, takes away what it takes away, and lights
// the wires it names. The conversation beside it and the chapters above it are play.js's, shared with the
// architecture's stories. The last step is the map as it is: what the steps leave in, with its own state now.

import { css as storyLook } from './story-look.js';

/** What each step shows: the ids it has in (as the steps add and take away), its chapter, the wires it lights. */
export function statesOf(steps) {
  const present = new Set();
  let chapter = -1;
  return steps.map((s) => {
    for (const id of s.add ?? []) present.add(id);
    for (const id of s.remove ?? []) present.delete(id);
    if (s.chapter) chapter++;
    return { step: s, chapter, ids: new Set(present), lit: (s.lit ?? []).map((w) => [...w].sort().join(' ')) };
  });
}

/** Every item any step brings in: what the story lays out. */
export const everyNamed = (steps) => new Set(steps.flatMap((s) => s.add ?? []));

/** How a story's marks look besides the flow's own: what comes in, and what a step lights. */
export const css = `${storyLook}
.lf-step .lf-shape, .lf-wire, .lf-head { transition: stroke 0.8s, stroke-width 0.8s, fill 0.8s; }
.lf-step.sp-new .lf-shape { stroke: var(--accent); stroke-width: var(--border-3); }
.lf-wire.sp-new, .lf-wire.sp-lit { stroke: var(--accent); stroke-width: var(--border-3); }
.lf-head.sp-new, .lf-head.sp-lit { fill: var(--accent); }
`;

/**
 * The flow's stage for play.js: `apply(k, dur)` shows step k. `marks` says what the picture drew: each step's mark
 * key and the items it stands for (`steps`: key to ids), each wire's keys and the steps at its ends (`wires`), and the
 * key of what each choice is (`says`: wire index to key).
 */
export function reveal({ frames, marks, t, send, later }) {
  let was = null;
  return {
    away: () => false,
    apply(k, dur) {
      const f = frames[k], list = [], fresh = [];
      const over = dur ? { over: dur } : {};
      const on = (ids) => ids.some((id) => f.ids.has(id));
      for (const [key, ids] of marks.steps) {
        const now = on(ids), then = was ? was.ids && marks.steps.get(key).some((id) => was.ids.has(id)) : false;
        list.push({ key, toggle: { 'sp-off': !now }, set: { opacity: now ? 1 : 0 }, ...over });
        if (now && !then && dur) fresh.push(key);
      }
      marks.wires.forEach((w, n) => {
        const now = on(w.from) && on(w.to), then = was ? w.from.some((id) => was.ids.has(id)) && w.to.some((id) => was.ids.has(id)) : false;
        const lit = f.lit.includes([w.item.from, w.item.to].sort().join(' '));
        for (const key of w.keys) list.push({ key, toggle: { 'sp-lit': now && lit } });
        if (!now) for (const key of [...w.keys, marks.says.get(n)].filter(Boolean)) list.push({ key, toggle: { 'sp-off': true }, set: { opacity: 0 } });
        else if (then || !dur) for (const key of [...w.keys, marks.says.get(n)].filter(Boolean)) list.push({ key, toggle: { 'sp-off': false }, set: { opacity: 1, 'stroke-dashoffset': 0 } });
        else {
          // Drawn in from what leads to what needs it, once the steps at both ends have come in.
          const [path, head] = w.keys;
          list.push({ key: path, set: { opacity: 0, 'stroke-dashoffset': 1 } }, { key: head, set: { opacity: 0 } });
          later(dur * 0.6, () => send([{ key: path, toggle: { 'sp-off': false, 'sp-new': true }, set: { opacity: 1 } }, { key: path, set: { 'stroke-dashoffset': 0 }, over: t('draw') }, { key: head, toggle: { 'sp-off': false, 'sp-new': true }, set: { opacity: 1 }, over: t('draw') }, ...(marks.says.get(n) ? [{ key: marks.says.get(n), toggle: { 'sp-off': false }, set: { opacity: 1 }, over: t('draw') }] : [])]));
          fresh.push(path, head);
        }
      });
      // What a step brings is in the accent a while.
      if (fresh.length) (list.push(...fresh.map((key) => ({ key, toggle: { 'sp-new': true } }))), later(t('new_for'), () => send(fresh.map((key) => ({ key, toggle: { 'sp-new': false } })))));
      send(list);
      was = f;
    },
  };
}
