// The view every item that waits on something has: what holds it, step by step, and nothing else.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import '../src/views.ts';
import { HOLDING, lens } from '../src/lens.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';

const human: Actor = { kind: 'human', name: 'test' };

async function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-holding-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  return new Archipelago(await openDb(), new Registry(dir));
}

type Answer = { items: { id: string }[]; links: { kind: string; from: string; to: string }[]; views: { id: string; title: string }[]; view: string; style: Record<string, unknown>; controls: string[]; said: string };

test('what holds an item is all it waits on, step by step, and nothing beside it', async () => {
  const l = await map();
  const { created: c } = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work.project', title: 'Product' },
      { op: 'create', ref: 'release', type: 'event', title: 'First release' },
      { op: 'create', ref: 'build', type: 'work.task', title: 'Build it' },
      { op: 'create', ref: 'design', type: 'work.task', title: 'Design it' },
      { op: 'create', ref: 'done', type: 'work.task', title: 'Already done', status: 'done' },
      { op: 'create', ref: 'beside', type: 'work.task', title: 'In the project, holding nothing' },
      { op: 'create', ref: 'after', type: 'work.task', title: 'Waits on the release' },
      ...['release', 'build', 'design', 'done', 'beside', 'after'].map((from) => ({ op: 'link' as const, type: 'part_of', from, to: 'p' })),
      { op: 'link', type: 'depends_on', from: 'release', to: 'build' },
      { op: 'link', type: 'depends_on', from: 'build', to: 'design' },
      { op: 'link', type: 'depends_on', from: 'release', to: 'done' },
      { op: 'link', type: 'depends_on', from: 'after', to: 'release' },
    ],
  })) as { created: Record<string, string> };

  // Offered beside the view it opens on, because some of what it waits on is open.
  const around = (await lens(l, { from: c.release })) as Answer;
  assert.ok(around.views.some((v) => v.id === HOLDING));

  const held = (await lens(l, { from: c.release, lens: HOLDING })) as Answer;
  const ids = new Set(held.items.map((i) => i.id));
  assert.deepEqual(ids, new Set([c.release, c.build, c.design]), 'what holds it, two steps down; not what is finished, beside it or after it');
  assert.equal(held.view, HOLDING);
  assert.equal(held.style.shape, 'flow');
  assert.deepEqual(held.controls, ['lit', 'closed']);
  assert.match(held.said, /What "First release" waits on/);
  assert.ok(held.links.some((k) => k.kind === 'depends_on' && k.from === c.build && k.to === c.design));

  // What is finished is there when asked for.
  const all = (await lens(l, { from: c.release, lens: HOLDING, fold: ['system'] })) as Answer;
  assert.ok(all.items.some((i) => i.id === c.done));

  // An item that waits on nothing open is not offered it.
  const design = (await lens(l, { from: c.design })) as Answer;
  assert.ok(!design.views.some((v) => v.id === HOLDING));
});

test('what holds an item says only what waits on what: no link is lifted to what holds its end', async () => {
  const l = await map();
  const { created: c } = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'go', type: 'work.decision', title: 'Go ahead?' },
      { op: 'create', ref: 'list', type: 'work.task', title: 'The checklist' },
      { op: 'create', ref: 'study', type: 'work.task', title: 'A study on the list' },
      { op: 'link', type: 'depends_on', from: 'go', to: 'list' },
      { op: 'link', type: 'part_of', from: 'study', to: 'list' },
      // The study waits on the decision; drawn lifted, the checklist would seem to.
      { op: 'link', type: 'depends_on', from: 'study', to: 'go' },
    ],
  })) as { created: Record<string, string> };
  const held = (await lens(l, { from: c.go, lens: HOLDING })) as Answer;
  assert.deepEqual(held.links.map((k) => [k.from, k.to]), [[c.go, c.list]]);
});
