// What a look's page breaks of the rules a machine reads (packs/look_draw/kernel/checks.ts): each rule as a pure
// function over what the probe saw, and the probe itself on a fixture page in the server's Chrome (skipped where there
// is none), breaking each rule once and keeping to each once.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capped, checksOf, pastBy, pastFrame, PROBE, smallText, wrappedRow, type Probe, type Seen } from '../packs/look_draw/kernel/checks.ts';
import { chromeBinary, openBrowser } from '../packs/look_draw/kernel/chrome.ts';

const box = (l: number, t: number, r: number, b: number) => ({ l, t, r, b });
const page = box(0, -1e9, 560, 1e9);

test('past_frame: a mark beyond its frame is told by how far and on which side; a pixel’s rounding is not', () => {
  assert.deepEqual(pastBy(box(10, 10, 600, 20), page), { right: 40 });
  assert.deepEqual(pastBy(box(-0.5, 0, 560.8, 20), page), {});
  const seen: Seen[] = [
    { mark: 'ul.list', text: 'Tasks', box: box(0, 0, 612, 300), frame: page, frame_is: 'viewport' },
    { mark: 'g.lf-island-head[e_isle0001]', box: box(90, 40, 330, 60), frame: box(100, 50, 300, 400), frame_is: 'land' },
    { mark: 'span.fits', box: box(0, 0, 100, 10), frame: page, frame_is: 'viewport' },
    { mark: 'g.on-canvas', box: box(-400, 0, 9000, 10) },
  ];
  assert.deepEqual(pastFrame(seen), [
    { rule: 'past_frame', mark: 'ul.list', said: 'ul.list “Tasks” runs 52 px past the right of the frame' },
    { rule: 'past_frame', mark: 'g.lf-island-head[e_isle0001]', said: 'g.lf-island-head[e_isle0001] runs 10 px past the left, 10 px past the top, 30 px past the right of its island’s land' },
  ]);
});

test('small_text: text drawn under 10 px, scale included; wrapped_row: a one-line element on two lines', () => {
  const seen: Seen[] = [
    { mark: 'span.tiny', text: 'x', box: box(0, 0, 1, 1), px: 8.4 },
    { mark: 'span.ok', box: box(0, 0, 1, 1), px: 9.98 },
    { mark: 'div.row', text: 'A long title', box: box(0, 0, 1, 1), px: 13, one_line: true, lines: 2 },
    { mark: 'div.row', box: box(0, 0, 1, 1), one_line: true, lines: 1 },
  ];
  assert.deepEqual(smallText(seen), [{ rule: 'small_text', mark: 'span.tiny', said: 'span.tiny “x” is drawn at 8.4 px, under 10' }]);
  assert.deepEqual(wrappedRow(seen), [{ rule: 'wrapped_row', mark: 'div.row', said: 'div.row “A long title” wraps onto 2 lines' }]);
});

test('a rule broken everywhere is told a few times and how many more', () => {
  const many = Array.from({ length: 30 }, (_, n) => ({ rule: 'small_text' as const, mark: `s${n}`, said: `s${n}` }));
  const out = capped(many, 12);
  assert.equal(out.length, 12);
  assert.deepEqual(out.at(-1), { rule: 'small_text', said: 'and 19 more like it' });
  assert.deepEqual(checksOf(null), []);
  assert.deepEqual(checksOf({ width: 560, height: 400, seen: [] }), []);
});

/** A page that breaks each rule once, and keeps to each once: a list past the 560 px edge, an island's head past its land, small text, a row that wraps. */
const FIXTURE = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif; width: 560px; overflow: hidden }
  .list { width: 600px; margin: 0; padding: 0 } .fits { width: 200px }
  .row { width: 120px } .ok-row { width: 300px; white-space: nowrap }
  .tiny { font-size: 8px } .cut { overflow: hidden; width: 50px } .cut span { display: inline-block; width: 400px }
</style></head><body>
  <div class="list">Tasks</div>
  <div class="fits">Fits</div>
  <div class="row">A title too long for its row here</div>
  <div class="ok-row row">One line, kept to</div>
  <span class="tiny">Tiny</span>
  <div class="cut"><span>Cut by its box, not past it</span></div>
  <div id="canvas"><svg width="500" height="300"><g class="lf-region"><g class="lf-land"><rect x="100" y="50" width="200" height="200"/></g>
    <text class="lf-head" x="60" y="80" font-size="14">Head</text><text class="lf-in" x="150" y="120" font-size="14">In</text></g>
    <text class="far" x="480" y="20" font-size="14">On the canvas, past nothing</text></svg></div>
</body></html>`;

const browserHere = chromeBinary();
test('in a browser, the probe reads a fixture page: each flaw once, nothing it keeps to', { skip: !browserHere && 'no Chrome here (set CHROME)' }, async () => {
  const b = await openBrowser();
  try {
    const tab = await b.tab();
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
    await tab.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE)}` });
    let probe: Probe | undefined;
    for (let n = 0; n < 50 && !probe?.seen.length; n++) {
      await new Promise((r) => setTimeout(r, 100));
      probe = await tab.evaluate<Probe>(PROBE).catch(() => undefined);
    }
    const checks = checksOf(probe);
    const by = (rule: string) => checks.filter((c) => c.rule === rule).map((c) => c.mark);
    assert.deepEqual(by('past_frame').sort(), ['div.list', 'text.lf-head'], JSON.stringify(checks));
    assert.deepEqual(by('small_text'), ['span.tiny']);
    assert.deepEqual(by('wrapped_row'), ['div.row']);
    await tab.close();
  } finally {
    b.close();
  }
});
