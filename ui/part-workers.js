// How the page reaches a pack version's parts: the frame drawings run in (ui/layout.js warmLayouts) starts a worker
// for the version and hands back a port to it (ui/draw-parts.js). What goes over the port, and what checks and renders
// the marks that come back, is the host's (ui/part-inside.js says the words).

import { warmLayouts } from './layout.js';

/** Each version asked for, by its name: its port once the frame gives it, and the box it was asked of. */
const asked = new Map();
let hearing = false;

function hear(ev) {
  const said = ev.data ?? {};
  if (typeof said.version !== 'string' || !String(said.type).startsWith('part-')) return;
  const one = asked.get(said.version);
  // Only the frame the version was asked of speaks for it.
  if (!one || ev.source !== one.box.frame.contentWindow) return;
  if (said.type === 'part-port' && ev.ports[0]) one.resolve(ev.ports[0]);
  else if (said.type === 'part-failed' || said.type === 'part-stopped') (asked.delete(said.version), one.reject(new Error(String(said.message ?? 'The pack stopped.').slice(0, 300))), one.stopped?.(said));
}

/**
 * The port of a pack version's worker, its parts loaded from `modules` (index.js exports `parts`). Asked again, the
 * same port; once it failed or was stopped, a new worker. `stopped` hears a version stopped after it answered.
 */
export async function partPort(version, modules, stopped) {
  if (!asked.has(version) || !asked.get(version).box.frame.isConnected) {
    const box = warmLayouts();
    if (!hearing) ((hearing = true), addEventListener('message', hear));
    const one = { box, stopped };
    one.port = new Promise((resolve, reject) => Object.assign(one, { resolve, reject }));
    asked.set(version, one);
    await box.ready;
    box.frame.contentWindow.postMessage({ type: 'part-load', version, modules }, '*');
  }
  return asked.get(version).port;
}

/** The version's worker ended, its parts with it: none of them is on screen any more. */
export function endPart(version) {
  const one = asked.get(version);
  if (!one) return;
  asked.delete(version);
  one.port.then((port) => port.close(), () => {});
  one.box.frame.contentWindow?.postMessage({ type: 'part-end', version }, '*');
}
