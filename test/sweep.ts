// What is left in the machine's temp folder from what did not clean up after itself, removed by the next test run
// (scripts/test.ts): a run that was killed, a branch from before each run had a folder of its own, a test run by hand
// with `node --test`.

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DAY = 86_400_000;
/** What is kept there on purpose, for later runs and for servers (src/db.ts, src/layouts.ts), and a server's Chrome (src/chrome.ts sweeps those). */
const KEPT = /^pelago-(blank-|drawings$|look-)/;
/** A drawing laid out by its hash is laid out again when it is next asked for, so an old one costs nothing to lose. */
const DRAWING_DAYS = 30;

const removeOlder = (folder: string, names: (name: string) => boolean, days: number, now: number) => {
  for (const name of readdirSync(folder)) {
    if (!names(name)) continue;
    const at = join(folder, name);
    try {
      if (now - statSync(at).mtimeMs > days * DAY) rmSync(at, { recursive: true, force: true });
    } catch {} // another run's sweep got there first, or something still holds it: the next one tries again
  }
};

/** Remove what the tests left in `temp` over a day old (a younger one may be another run's). */
export function sweepTemp(temp: string, now = Date.now()) {
  removeOlder(temp, (name) => name.startsWith('pelago-') && !KEPT.test(name), 1, now);
  try {
    removeOlder(join(temp, 'pelago-drawings'), () => true, DRAWING_DAYS, now);
  } catch {} // none laid out yet
}
