// The islands Auto puts on Home now (./islands-list.js, AUTO): worked out by the side bar (./island-picker.js) from when
// work last changed on each island, and drawn by Home (./canvas.js) beside the person's own list. Held here so neither
// imports the other; it is never kept, only worked out again as the log moves.

let ids = [];
const heard = new Set();

/** The islands Auto has on now, the latest changed first. */
export const autoIslands = () => ids;

/** Hear the islands Auto has on change; answers how to stop. */
export const onAuto = (f) => (heard.add(f), () => heard.delete(f));

/** Set what Auto has on: told only when it differs. */
export function setAuto(next) {
  if (next.length === ids.length && next.every((x, k) => x === ids[k])) return;
  ids = next;
  heard.forEach((f) => f(ids));
}
