// What the tests of the drawings a pack ships share (test/layouts*.test.ts): a small system kept on the map, and a
// drawing's pictures captured in a real browser and compared with what the kernel drew before it.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from './browser.ts';

/** A small system on the map, its picture kept as a view drawn as architecture. */
export async function system(call: (path: string, token?: string, body?: unknown) => Promise<any>) {
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'A system' },
      { op: 'create', ref: 'e', type: 'environment', title: 'A server', status: 'up' },
      { op: 'create', ref: 'a', type: 'component', title: 'Doors', status: 'up' },
      { op: 'create', ref: 'b', type: 'component', title: 'Store', status: 'up', props: { role: 'data' } },
      { op: 'link', type: 'part_of', from: 'e', to: 'p' },
      { op: 'link', type: 'part_of', from: 'a', to: 'e' },
      { op: 'link', type: 'part_of', from: 'b', to: 'e' },
      { op: 'link', type: 'calls', from: 'a', to: 'b' },
    ],
  })).result.created as Record<string, string>;
  const kept = await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', status: 'current', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of', 'calls'], steps: 3 }, style: { shape: 'architecture' } } },
      { op: 'link', type: 'about', from: 'l', to: made.p },
      { op: 'create', ref: 's', type: 'style', title: 'As architecture', status: 'current', props: { shape: 'architecture' } },
      { op: 'link', type: 'about', from: 's', to: made.p },
    ],
  });
  return { ...made, ...kept.result.created } as Record<string, string>;
}

/** What the kernel drew for a shape, on a machine like this one (test/fixtures/layouts). */
export const golden = (shape: string) => join(import.meta.dirname, 'fixtures', 'layouts', `${shape}.golden.${process.platform}.json`);

/**
 * Each case drawn by `drawing` in the page, every one checked to hold `mark`, and compared with what `file` keeps: the
 * marks, the looks, hovering, lighting and the key. Text is measured by the fonts of the machine, so it is compared
 * with what was drawn on one like it. A change meant to draw otherwise keeps what it now draws, with GOLDEN_WRITE=1.
 */
export async function drawsAsBefore<C extends { name: string; style: object }>(page: Page, cases: C[], drawing: unknown, mark: string, file: string): Promise<C[]> {
  await page.evaluate(readFileSync(join(import.meta.dirname, 'layout-capture.js'), 'utf8'));
  const drawn = cases.map((c) => ({ ...c, style: { ...c.style, drawing } }));
  const now: any = await page.evaluate(`(async () => { const { drawWith } = await import('/layout.js'); return captureDrawings(drawWith, ${JSON.stringify(drawn)}); })()`);
  for (const c of drawn) assert.ok(now[c.name].html.includes(mark), `${c.name} is drawn: ${now[c.name].html.slice(0, 200)}`);
  if (process.env.GOLDEN_WRITE) writeFileSync(file, `${JSON.stringify(now)}\n`);
  else if (existsSync(file)) {
    const was = JSON.parse(readFileSync(file, 'utf8'));
    for (const name of Object.keys(was)) {
      const [a, b] = [was[name], now[name]];
      assert.equal(b.html, a.html, `${name}: the marks`);
      assert.deepEqual(b.styles.map((k: number) => b.looks[k]), a.styles.map((k: number) => a.looks[k]), `${name}: the looks`);
      for (const k of ['hover', 'after_hover', 'dim', 'key']) assert.deepEqual(b[k], a[k], `${name}: ${k}`);
    }
  }
  return drawn;
}
