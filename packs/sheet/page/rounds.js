// A screen's rounds (the rounds piece, packs/loader/kernel/slots.ts): the pictures kept of it round by round, read from
// the field the piece names, `[{ wide: { id, url? }, narrow: { id, url? }, commit?, at?, checks?: [{ rule, said, ok? }] }]`
// oldest first. Drawn newest first, a row per round: its commit and when as one line with its failed checks as marks,
// then its wide and narrow pictures side by side. A click on a picture opens it whole. Every length is the style's
// (the sheet's preset, `round_*`). It imports nothing: it is handed how to make an element, an age and a picture's
// address, so it is tested as it is (test/sheet-rounds.test.ts).

/** The rounds a field holds, newest first; what is not a round is left out. */
export const roundsOf = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((r) => r && typeof r === 'object' && (side(r.wide) || side(r.narrow)))
    .map((r, i) => ({ ...r, n: i + 1 }))
    .reverse();

/** A picture of a round: a kept look's id, or an address the page loads. */
const side = (s) => (s && typeof s === 'object' && (typeof s.id === 'string' || typeof s.url === 'string') ? s : null);

/** The checks a round failed: every one not marked ok. */
export const failed = (round) => (Array.isArray(round.checks) ? round.checks.filter((c) => c && typeof c === 'object' && c.ok !== true) : []);

/** Its picture, whole, over the page until a click. */
const whole = (h, src, title) => {
  const box = h('dialog', { class: 'round-whole', title: 'Click to close', style: 'padding: 0; max-width: var(--round-whole); max-height: var(--round-whole-high); border: var(--border-1) solid var(--line); background: var(--figure)', onclick: () => box.close(), onclose: () => box.remove() }, h('img', { src, alt: title, style: 'display: block; max-width: var(--round-whole); max-height: var(--round-whole-high)' }));
  return box;
};

/** One picture of a round, at its share of the row; its address is asked for once it is on the page. */
const picture = (h, s, which, round, src) => {
  const title = `Round ${round.n}, ${which}`;
  const img = h('img', { alt: title, title: `${title}: click to open it whole`, style: 'display: block; width: 100%; height: auto; cursor: zoom-in; border: var(--border-1) solid var(--line); border-radius: var(--radius-2); background: var(--figure)' });
  img.onclick = () => {
    if (!img.src) return;
    const box = whole(h, img.src, title);
    img.ownerDocument.body.append(box);
    box.showModal();
  };
  const at = Promise.resolve(s.url ?? src(s)).then((url) => (url ? (img.src = url) : img.remove()), () => img.remove());
  return { node: h('figure', { 'data-side': which, style: `margin: 0; min-width: 0; flex: 0 1 var(--round-${which})` }, img), at };
};

/** The line a round reads as: its number, its commit, when, and its failed checks as marks (the said in the tooltip). */
const line = (h, round, ago) => {
  const bad = failed(round);
  const checks = Array.isArray(round.checks) ? round.checks.length : 0;
  return h(
    'div',
    { class: 'row-top', style: 'display: flex; gap: var(--space-5); align-items: baseline; white-space: nowrap; overflow: hidden' },
    h('span', { class: 'n', title: `Round ${round.n}` }, `#${round.n}`),
    round.commit ? h('code', { class: 'gist', title: String(round.commit) }, String(round.commit).slice(0, 7)) : null,
    round.at ? ago(round.at) : null,
    h('span', { class: 'grow' }),
    bad.map((c) => h('span', { class: 'mark bad', title: String(c.said ?? c.rule ?? '') }, String(c.rule ?? 'check'))),
    checks > 0 && !bad.length ? h('span', { class: 'mark ok', title: round.checks.map((c) => c.rule).join(', ') }, `${checks} ✓`) : null,
  );
};

/**
 * The strip: a row per round, newest first. `limit` rounds are shown and the rest are a click away. Answers the node
 * and `at`, which settles once every picture shown has its address.
 */
export function roundsStrip(rounds, { h, ago, src, limit }) {
  const all = roundsOf(rounds);
  const pending = [];
  const row = (round) => {
    const sides = [['wide', round.wide], ['narrow', round.narrow]].filter(([, s]) => side(s)).map(([which, s]) => picture(h, s, which, round, src));
    pending.push(...sides.map((s) => s.at));
    return h('li', { 'data-round': round.n, style: 'display: grid; gap: var(--space-4); padding: var(--space-5) var(--space-8)' }, line(h, round, ago), h('div', { style: 'display: flex; gap: var(--round-gap); align-items: flex-start' }, sides.map((s) => s.node)));
  };
  const shown = limit > 0 ? all.slice(0, limit) : all;
  const list = h('ul', { class: 'rows rounds', style: 'list-style: none; margin: 0; padding: 0' }, shown.map(row));
  const rest = all.length - shown.length;
  const more = rest > 0 && h('button', { title: 'The older rounds', onclick: () => (more.remove(), list.append(...all.slice(shown.length).map(row))) }, `${rest} older`);
  return { node: h('div', {}, list, more), at: () => Promise.all(pending), count: all.length };
}
