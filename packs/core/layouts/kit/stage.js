// Each step of a layout as it ends, for the explainer that animates it (the kit, task e_7v52ek3c): a layout says
// `stage(name, snapshot)` after each of its steps, and whoever listens (`stages(fn)`) is told; nobody listens on a page.
// Layer: graph. Pure but for the one listener.

let listener = null;

/** Listen to every stage from now on (`null` to stop): fn(name, snapshot). */
export const stages = (fn) => (listener = fn);

/** A step ended: `snapshot` is plain data (places, lines), copied so a later step cannot change it. */
export const stage = (name, snapshot) => listener?.(name, JSON.parse(JSON.stringify(snapshot, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v))));
