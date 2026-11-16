// The search's starts side by side (task e_bsp7jhrw). The embedding's starts (./embedding.js) are independent: each
// leans its line its own way, `k`. Where the drawing is given helpers (`tools.helpers`, workers of the frame's walled in
// as its own is, each running this drawing's code: packs/walls/page/draw-inside.js), the first start is run here, and
// the rest are sent to the helpers as they come free. Their results are judged in `k` order by the loop's own rules
// (`goOn`, `less`), so the starts that count are those the loop would have run, and the winner the one it would have
// kept: the picture is the same, only sooner. The work they count is counted as before, never timed.
//
// The picture is drawn at once, as it always was, and where a start after the first is wanted the embedding stops
// (`spread`, thrown); once the helpers have run them, the picture is drawn again with their results, the winner's
// start taken whole from the helper that ran it. Without helpers, or where one fails, it is drawn one start after
// another. Layer: topology.

import { goOn, less, startScored, within } from './embedding.js';

/** How many graphs a helper keeps its starts for: the one being drawn, and the one before. */
const KEEP = 2;
const kept = new Map();

/** What a helper does when asked (the drawing exports these as `helpers`): run a start, and hand over one it ran. */
export const helpers = {
  start({ key, prep, k }) {
    const { tried, score, work } = startScored(prep, k);
    if (!kept.has(key)) kept.set(key, new Map());
    kept.get(key).set(k, tried);
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
    return { score, work };
  },
  take: ({ key, k }) => kept.get(key)?.get(k) ?? null,
};

/**
 * The starts after the first, run on `pool` ({ size, run(name, arg, at) }) and judged in order: the winner's `k`, its
 * `score`, how many starts the loop runs (`starts`) and, where it is not the first, the start itself (`tried`).
 */
export function search({ key, prep, rules, first }, pool) {
  return new Promise((resolve, reject) => {
    let best = { score: first.score, work: first.work, k: 0, at: -1 }, spent = first.work, starts = 1, next = 1, issued = 1, stopped = false;
    const results = new Map(), free = Array.from({ length: pool.size }, (_, at) => at);
    const finish = () => {
      if (!best.k) return resolve({ k: 0, score: best.score, starts });
      pool.run('take', { key, k: best.k }, best.at).then((tried) => (tried ? resolve({ k: best.k, score: best.score, starts, tried }) : reject(new Error('A helper lost its start'))), reject);
    };
    // The results in order, as the loop would come to them, until its rules end it.
    const advance = () => {
      while (results.has(next) && goOn(best, spent, next, rules)) {
        const r = results.get(next);
        results.delete(next);
        (spent += r.work), starts++;
        if (less(r.score, best.score)) best = { ...r, k: next };
        next++;
      }
      if (!goOn(best, spent, next, rules)) stopped = true;
    };
    // Each helper free is given the next start the rules may still want; what they come to is judged as it arrives.
    const pump = () => {
      if (stopped) return finish();
      while (free.length && issued < rules.most && issued - best.k <= rules.idle) {
        const k = issued++, at = free.shift();
        pool.run('start', { key, prep, k }, at).then((r) => {
          free.push(at);
          if (stopped) return;
          results.set(k, { score: r.score, work: r.work, at });
          advance();
          pump();
        }, (err) => ((stopped = true), reject(err)));
      }
    };
    pump();
  });
}

/**
 * A drawing's `picture` whose map spreads its starts over the helpers it is given: `draw(input, tools)` itself where
 * there are none. Its answer is a promise where the starts were spread, the picture otherwise.
 */
export function spreading(draw) {
  return (input, tools) => {
    const pool = tools?.helpers;
    if (!(pool?.size > 0)) return draw(input, tools);
    const plan = { known: new Map(), first: new Map() };
    const once = () => within(plan, () => draw(input, tools));
    const again = async (need) => {
      for (;;) {
        if (plan.known.has(need.key)) return draw(input, tools);
        try {
          plan.known.set(need.key, await search(need, pool));
        } catch {
          // A helper failed or stopped: the picture is drawn one start after another, as it always was.
          return draw(input, tools);
        }
        try {
          return once();
        } catch (err) {
          if (!err?.spread) throw err;
          need = err.spread;
        }
      }
    };
    try {
      return once();
    } catch (err) {
      if (!err?.spread) throw err;
      return again(err.spread);
    }
  };
}
