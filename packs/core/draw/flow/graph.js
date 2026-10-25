// A lens answer as a flat graph (the flow's layout, ./layout.js, lays it out): items, and links each with its type, and
// what the order is without its loops and without the wires another path implies. Pure.

export const ORDER = 'depends_on', NEAR = 'part_of';
/** What an item says of its state when the answer says nothing (the flat lens's does not). */
export const QUIET = { blocked: false, waits_on: [], sessions: 0, needs_you: false };

/** The highest and the lowest of many numbers, which Math.max(...list) cannot take past the stack's size. */
export const highest = (list) => list.reduce((m, v) => (v > m ? v : m), -Infinity);
export const lowest = (list) => list.reduce((m, v) => (v < m ? v : m), Infinity);

/**
 * A lens answer as a flat graph: items, and links each with its type. The flat lens's answer is that already; the
 * older lens's names its links' types `kind` and says what an item is part of as its `inside`, read here as part_of.
 * The link types the style draws no wire for (`undrawn`: core's house style, tagged) are left out.
 */
export function flatten({ items, links = [], undrawn = [] }) {
  const ids = new Set(items.map((i) => i.id)), skip = new Set(undrawn), seen = new Set(), out = [];
  const add = (type, from, to, says) => {
    const key = `${type} ${from} ${to}`;
    if (!type || skip.has(type) || from === to || !ids.has(from) || !ids.has(to) || seen.has(key)) return;
    seen.add(key);
    out.push({ type, from, to, ...(says && { says }) });
  };
  for (const l of links) add(l.type ?? l.kind, l.from, l.to, l.says ?? l.props?.says);
  for (const i of items) if (i.inside) add(NEAR, i.id, i.inside);
  return { items: items.map((i) => ({ ...i, state: i.state ?? QUIET, choices: i.choices ?? i.fields?.choices })), links: out };
}

/** A list for each key, of what `pick` gives. */
export const grouped = (list, key, pick = (v) => v) => {
  const by = new Map();
  for (const v of list) (by.get(key(v)) ?? by.set(key(v), []).get(key(v))).push(pick(v));
  return by;
};

/** The order without its loops: a wire back to a step still being walked from is dropped. */
export function acyclic(edges, ids) {
  const out = grouped(edges, (e) => e.a), state = new Map(), back = new Set();
  for (const start of ids) {
    if (state.has(start)) continue;
    const stack = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1], list = out.get(top[0]) ?? [];
      if (top[1] >= list.length) (state.set(top[0], 2), stack.pop());
      else {
        const e = list[top[1]++], s = state.get(e.b);
        if (s === 1) back.add(e);
        else if (!s) (state.set(e.b, 1), stack.push([e.b, 0]));
      }
    }
  }
  return edges.filter((e) => !back.has(e));
}

/** The order without the wires another path already implies. */
export function reduced(edges) {
  const out = grouped(edges, (e) => e.a, (e) => e.b);
  const implied = (a, b) => {
    const stack = out.get(a).filter((v) => v !== b), been = new Set();
    while (stack.length) {
      const v = stack.pop();
      if (v === b) return true;
      if (!been.has(v)) (been.add(v), stack.push(...(out.get(v) ?? [])));
    }
    return false;
  };
  return edges.filter((e) => !implied(e.a, e.b));
}
