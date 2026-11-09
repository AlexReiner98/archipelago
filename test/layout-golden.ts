// What the tests of the drawings a pack ships share (test/layouts*.test.ts): a small system kept on the map (its types
// from test/fixtures/systems, as the code pack, now hosted, declares them; the server given that folder), and a
// drawing's pictures captured in a real browser and compared with what the kernel drew before it.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from './browser.ts';

/** A small system on the map, its picture kept as a view drawn as architecture. */
export async function system(call: (path: string, token?: string, body?: unknown) => Promise<any>) {
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'A system' },
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
      { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of', 'calls'], steps: 3 }, style: { shape: 'architecture' } } },
      { op: 'link', type: 'about', from: 'l', to: made.p },
      { op: 'create', ref: 's', type: 'style', title: 'As architecture', status: 'current', props: { shape: 'architecture' } },
      { op: 'link', type: 'about', from: 's', to: made.p },
    ],
  });
  return { ...made, ...kept.result.created } as Record<string, string>;
}

/**
 * A file of test/fixtures/layouts kept for this platform: text is measured by the fonts of the machine, so Windows and
 * Linux each keep their own (`name.<platform>.json`). The Linux ones are what CI's runner drew.
 */
export const fixture = (name: string) => join(import.meta.dirname, 'fixtures', 'layouts', `${name}.${process.platform}.json`);

/** What the kernel drew for a shape, on a machine like this one. */
export const golden = (shape: string) => fixture(`${shape}.golden`);

/**
 * What a golden holds, or null where this platform keeps none. Under CI a missing golden fails, so nothing passes there
 * without comparing: what was drawn is written to runs/goldens/ (uploaded with the run, see tests.yml), to be committed
 * as the golden once looked at. Elsewhere a missing one is skipped, and written with GOLDEN_WRITE=1.
 */
export function kept(file: string, now: unknown): any {
  if (process.env.GOLDEN_WRITE) return writeFileSync(file, `${JSON.stringify(now)}\n`), null;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (!process.env.CI) return null;
  const out = join(import.meta.dirname, '..', 'runs', 'goldens');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, basename(file)), `${JSON.stringify(now)}\n`);
  assert.fail(`No golden ${basename(file)} for ${process.platform}: what was drawn is in runs/goldens/ (the run's goldens artifact). Commit it to test/fixtures/layouts/ once it looks right.`);
}

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
  const was = kept(file, now);
  if (was) {
    for (const name of Object.keys(was)) {
      const [a, b] = [was[name], now[name]];
      assert.equal(b.html, a.html, `${name}: the marks`);
      assert.deepEqual(b.styles.map((k: number) => b.looks[k]), a.styles.map((k: number) => a.looks[k]), `${name}: the looks`);
      for (const k of ['hover', 'after_hover', 'dim', 'key']) assert.deepEqual(b[k], a[k], `${name}: ${k}`);
    }
  }
  return drawn;
}
