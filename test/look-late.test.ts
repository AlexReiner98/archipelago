// A look not drawn in time says where it was stuck (packs/look_draw/kernel/look-draw.ts, lateWhy; sighting e_y6jxap7q,
// round 3 of e_unru8ftt): the step it was on, and what the page last said of its drawing, not only that it was late.
// Words first, without a browser; then, in a real Chrome (skipped where there is none), a page that stalls once it has
// said it is drawing, and one that stalls once it has said it drew, with the limit shortened so each is closed in seconds.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { drawLook, lateWhy, limits, stopLayout } from '../packs/look_draw/kernel/look-draw.ts';
import { chrome } from './browser.ts';

after(stopLayout);

test('a late look says the step it was stuck on and what the page last said', () => {
  assert.equal(lateWhy(45_000, 'opening the page', {}), 'The view had not drawn within 45 s: it was stuck opening the page, and its page stopped answering, so it was closed.');
  assert.match(lateWhy(45_000, 'waiting for the page to say it had drawn', {}), /stuck waiting for the page to say it had drawn; the page had said nothing of its drawing,/);
  assert.match(lateWhy(45_000, 'taking its picture', { state: 'drawn' }), /stuck taking its picture; the page last said it was drawn,/);
  assert.match(lateWhy(3000, 'reading its faces', { state: 'error', why: 'x'.repeat(500) }), /within 3 s: .*\(x{120}\),/, 'its why is cut');
});

/** A page that says `state` on its root and runs `then`, which never yields. */
const stalls = (state: string, then: string) => `data:text/html,${encodeURIComponent(`<p>stall</p><script>document.documentElement.dataset.look = '${state}'; ${then}</script>`)}`;

test('in a browser, a look that stalls is closed and names its step', { skip: !chrome() && 'no Chrome here (set CHROME)' }, async () => {
  const was = limits.late;
  limits.late = 4000;
  try {
    await assert.rejects(drawLook(stalls('drawing', 'setTimeout(() => { for (;;) {} }, 300);'), 'pass', 400, 300, 'dark'), /within 4 s: it was stuck waiting for the page to say it had drawn; the page last said it was drawing,/);
    // Drawn, and stalled the moment the look has read so: its picture is never taken.
    const once = "const root = document.documentElement; Object.defineProperty(document, 'documentElement', { get() { setTimeout(() => { for (;;) {} }, 0); return root; } });";
    await assert.rejects(drawLook(stalls('drawn', once), 'pass', 400, 300, 'dark'), /within 4 s: it was stuck taking its picture; the page last said it was drawn,/);
  } finally {
    limits.late = was;
  }
});
