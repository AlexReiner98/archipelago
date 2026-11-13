// The walls a pack version's parts run behind (the foot of packs/walls/page/draw-marks.js, partInside in packs/walls/page/draw-inside.js, partPort in packs/walls/page/layout.js), in a real
// browser (skipped where there is no Chrome): one worker for each version, reached by the port the frame hands the
// page; a part reaches nothing of the page and nothing on the network, cannot see another version, and is stopped
// when it stops answering. What a drawing may not do is test/layouts.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

/** A version with one part, `probe`, whose answer is what `body` returns (input and tools in scope). */
const version = (body: string) => ({ probe: { 'index.js': `export default async function probe(input, tools) { ${body} }` } });

/** In the page: load each version, mount its probe, and gather what each says until it says something or time runs out. */
const drive = (versions: Record<string, object>, wait = 200) => `(async () => {
  const { partPort } = await import('/layout.js');
  const out = {};
  await Promise.all(Object.entries(${JSON.stringify(versions)}).map(async ([name, code]) => {
    const said = (out[name] = []);
    let stopped;
    try {
      const port = await partPort(name, code, (s) => (stopped = s.type + ': ' + s.message));
      port.onmessage = (ev) => said.push(ev.data);
      port.postMessage({ type: 'mount', id: 'a', part: 'probe', input: { name } });
      for (let n = 0; n < ${wait} && !said.length && !stopped; n++) await new Promise((r) => setTimeout(r, 25));
    } catch (err) {
      said.push({ type: 'rejected', message: err.message });
    }
    if (stopped) said.push({ type: 'stopped', message: stopped });
  }));
  return out;
})()`;

test('in a browser, a pack version runs walled in its own worker and reaches nothing', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(
      drive({
        // What it may reach: nothing of the page, nothing on the network.
        reach: version(
          `let net = 'blocked'; try { await fetch(${JSON.stringify(`${base}/api/view`)}, { method: 'POST' }); net = 'reached'; } catch {}
           return { marks: [typeof document, typeof window, typeof parent, typeof localStorage, net].join(' ') };`,
        ),
        // Two versions on one screen are two workers: what one leaves on its global the other does not see.
        one: version(`self.left = 'one'; return { marks: 'one ' + input.name };`),
        two: version(`await new Promise((r) => setTimeout(r, 100)); return { marks: 'two ' + typeof self.left + ' ' + input.name };`),
        // What cannot be sent is an error of the part's, and the worker still answers.
        unclonable: version(`return { marks: { f() {} } };`),
        // A part that throws says so.
        throws: version(`throw new Error('no such luck');`),
        // Code that does not load is refused.
        broken: { probe: { 'index.js': 'export default {' } },
      }),
    );
    assert.equal(await page.evaluate('typeof self.left'), 'undefined', "the page's own globals are untouched");
    const marks = (name: string) => got[name].find((m: any) => m.type === 'marks')?.marks;
    assert.equal(marks('reach'), 'undefined undefined undefined undefined blocked', JSON.stringify(got.reach));
    assert.equal(marks('one'), 'one one');
    assert.equal(marks('two'), 'two undefined two');
    assert.equal(got.unclonable[0]?.type, 'error', JSON.stringify(got.unclonable));
    assert.equal(got.throws[0]?.type, 'error');
    assert.match(got.throws[0]?.message, /no such luck/);
    assert.equal(got.broken[0]?.type, 'rejected', JSON.stringify(got.broken));

    // A version's parts hear events and updates in order, an unmounted one hears nothing, and a part it lacks is an error.
    const again: any = await page.evaluate(`(async () => {
      const { partPort } = await import('/layout.js');
      const port = await partPort('events', ${JSON.stringify(version(`let n = 0; return { marks: n, on: (e) => ++n + e.by, update: (i) => 'now ' + i.x, end: () => {} };`))});
      const said = [];
      port.onmessage = (ev) => said.push(ev.data);
      port.postMessage({ type: 'mount', id: 'a', part: 'probe', input: {} });
      port.postMessage({ type: 'event', id: 'a', event: { by: 2 } });
      port.postMessage({ type: 'update', id: 'a', input: { x: 'y' } });
      port.postMessage({ type: 'mount', id: 'b', part: 'none', input: {} });
      port.postMessage({ type: 'unmount', id: 'a' });
      port.postMessage({ type: 'event', id: 'a', event: { by: 2 } });
      for (let n = 0; n < 200 && said.length < 4; n++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 200));
      return said;
    })()`);
    assert.deepEqual(
      again.map((m: any) => [m.type, m.id, m.marks ?? m.message]),
      [
        ['marks', 'a', 0],
        ['marks', 'a', 3],
        ['marks', 'a', 'now y'],
        ['error', 'b', 'This pack has no part "none"'],
      ],
    );

    // A version that never answers is stopped in 12 seconds, and says so.
    const stuck: any = await page.evaluate(drive({ stuck: version(`for (;;) {}`) }, 800));
    assert.match(JSON.stringify(stuck.stuck), /did not answer for 12 seconds/);
  } finally {
    await page.close();
  }
});

test('in a browser, a part sends an action and hears what came of it, over its own port', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const said: any = await page.evaluate(`(async () => {
      const { partPort } = await import('/layout.js');
      const code = ${JSON.stringify(version(`setTimeout(async () => tools.marks('came ' + (await tools.act('save', { x: 1 })).status), 0); return { marks: 'asked' };`))};
      const port = await partPort('acts', code);
      const said = [];
      port.onmessage = (ev) => {
        said.push(ev.data);
        if (ev.data.type === 'act') port.postMessage({ type: 'acted', asked: ev.data.asked, status: 'applied' });
      };
      port.postMessage({ type: 'mount', id: 'p', part: 'probe', input: {} });
      for (let n = 0; n < 200 && said.length < 3; n++) await new Promise((r) => setTimeout(r, 25));
      return said;
    })()`);
    assert.deepEqual(said, [
      { type: 'marks', id: 'p', marks: 'asked' },
      { type: 'act', id: 'p', asked: 1, action: 'save', params: { x: 1 } },
      { type: 'marks', id: 'p', marks: 'came applied' },
    ]);
  } finally {
    await page.close();
  }
});

test('in a browser, a part on a slot that asks a decision answers a value, never marks', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const said: any = await page.evaluate(`(async () => {
      const { partPort } = await import('/layout.js');
      const code = ${JSON.stringify(version(`return { decide: (i) => (i.tabs.length ? { tab: i.tabs[0].id, front: true } : { later: true }) };`))};
      const port = await partPort('decides', code);
      const said = [];
      port.onmessage = (ev) => said.push(ev.data);
      port.postMessage({ type: 'mount', id: 'd', part: 'probe', input: {} });
      port.postMessage({ type: 'decide', id: 'd', asked: 1, input: { tabs: [{ id: 't1' }] } });
      port.postMessage({ type: 'decide', id: 'd', asked: 2, input: { tabs: [] } });
      port.postMessage({ type: 'decide', id: 'none', asked: 3, input: {} });
      for (let n = 0; n < 200 && said.length < 3; n++) await new Promise((r) => setTimeout(r, 25));
      return said;
    })()`);
    assert.deepEqual(said, [
      { type: 'decided', id: 'd', asked: 1, value: { tab: 't1', front: true } },
      { type: 'decided', id: 'd', asked: 2, value: { later: true } },
      { type: 'decided', id: 'none', asked: 3, value: null },
    ]);
  } finally {
    await page.close();
  }
});

test('in a browser, a part asks a live read and hears its answer, over its own port', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const said: any = await page.evaluate(`(async () => {
      const { partPort } = await import('/layout.js');
      const code = ${JSON.stringify(version(`setTimeout(async () => tools.marks('got ' + JSON.stringify(await tools.read('search', { q: 'roof' }))), 0); return { marks: 'asking' };`))};
      const port = await partPort('reads', code);
      const said = [];
      port.onmessage = (ev) => {
        said.push(ev.data);
        if (ev.data.type === 'read') port.postMessage({ type: 'readed', asked: ev.data.asked, value: [{ id: 'e_aaaaaaaa' }] });
      };
      port.postMessage({ type: 'mount', id: 'r', part: 'probe', input: {} });
      for (let n = 0; n < 200 && said.length < 3; n++) await new Promise((r) => setTimeout(r, 25));
      return said;
    })()`);
    assert.deepEqual(said, [
      { type: 'marks', id: 'r', marks: 'asking' },
      { type: 'read', id: 'r', asked: 1, name: 'search', params: { q: 'roof' } },
      { type: 'marks', id: 'r', marks: 'got [{"id":"e_aaaaaaaa"}]' },
    ]);
  } finally {
    await page.close();
  }
});
