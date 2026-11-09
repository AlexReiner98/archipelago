// The gate view: an event, what holds it by stream, what can follow it, and what is not yet sorted. Through the tools alone (#pelago/test), so it runs wherever the pack lives.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { call, human, make, mapWith } from '#pelago/test';

/** A map with this pack and the packs beside it. */
const fresh = () => mapWith(join(import.meta.dirname, '..'));

test('an event is a gate: what holds it by stream, what can follow, and what is not yet sorted', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'business', type: 'project', title: 'Business' },
    { op: 'create', ref: 'addin', type: 'feature', title: 'Add-in' },
    { op: 'create', ref: 'installer', type: 'feature', title: 'Installer' },
    { op: 'create', ref: 'docs', type: 'feature', title: 'Docs' },
    { op: 'create', ref: 'sign', type: 'task', title: 'Sign the package' },
    { op: 'create', ref: 'cert', type: 'decision', title: 'Which certificate?', owner: 'me' },
    { op: 'create', ref: 'clean', type: 'task', title: 'Uninstall leaves it clean', status: 'done' },
    { op: 'create', ref: 'hover', type: 'task', title: 'Hover cards' },
    { op: 'create', ref: 'extras', type: 'task', title: 'Capture extras' },
    { op: 'create', ref: 'guide', type: 'task', title: 'Write the guide' },
    { op: 'create', ref: 'pricing', type: 'decision', title: 'What does it cost?', owner: 'me' },
    { op: 'create', ref: 'release', type: 'release', title: 'Version 1.0' },
    { op: 'link', type: 'part_of', from: 'addin', to: 'app' },
    { op: 'link', type: 'part_of', from: 'installer', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'docs', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'sign', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'cert', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'clean', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'hover', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'extras', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'guide', to: 'docs' },
    { op: 'link', type: 'part_of', from: 'pricing', to: 'business' },
    { op: 'link', type: 'depends_on', from: 'sign', to: 'cert' },
    { op: 'link', type: 'ships', from: 'release', to: 'addin' },
    // A feature that holds the event brings its work; a single item sits under the stream it is part of.
    { op: 'link', type: 'depends_on', from: 'release', to: 'installer' },
    { op: 'link', type: 'depends_on', from: 'release', to: 'pricing' },
    { op: 'link', type: 'defers', from: 'release', to: 'hover' },
  ]);
  await call(l, human, 'init', { name: 'Owner' });
  type Gate = {
    counts: Record<string, number>;
    clear: boolean;
    to_sort: { id: string; stream: { title: string } | null }[];
    streams: { id: string | null; title: string | null; yours: number; progress: { done: number; total: number }; items: { id: string; yours: boolean; done: boolean; relation?: string }[] }[];
    can_follow: { id: string; relation: string }[];
  };
  const gate = (await call(l, human, 'view', { name: 'gate', params: { event: made.release } })) as Gate;
  assert.deepEqual(gate.counts, { holding: 4, open: 3, yours: 3, to_sort: 2, can_follow: 1 });
  assert.equal(gate.clear, false);
  // Not sorted: open work under what ships that is on neither side. What is held, deferred or outside what ships is not asked about.
  assert.deepEqual(gate.to_sort.map((x) => x.id).sort(), [made.extras, made.guide].sort());
  assert.equal(gate.to_sort.find((x) => x.id === made.guide)!.stream!.title, 'Docs');
  const installer = gate.streams.find((s) => s.id === made.installer)!;
  assert.deepEqual(installer.progress, { done: 1, total: 3 });
  // The decision is the owner's, and so is the task that cannot move until it is made.
  assert.equal(installer.yours, 2);
  assert.equal(installer.items.at(-1)!.id, made.clean, 'what is done comes last');
  const business = gate.streams.find((s) => s.id === made.business)!;
  assert.equal(business.items[0].id, made.pricing);
  assert.ok(business.items[0].relation, 'an item that holds the event itself says by which link');
  assert.deepEqual(gate.can_follow.map((x) => x.id), [made.hover]);

  // Sorting is two links; moving one across is an unlink and a link.
  await make(l, [
    { op: 'link', type: 'depends_on', from: made.release, to: made.guide },
    { op: 'link', type: 'defers', from: made.release, to: made.extras },
  ]);
  const sorted = (await call(l, human, 'view', { name: 'gate', params: { event: made.release } })) as Gate;
  assert.equal(sorted.counts.to_sort, 0);
  assert.equal(sorted.streams.find((s) => s.id === made.docs)!.items[0].id, made.guide);

  await assert.rejects(call(l, human, 'view', { name: 'gate', params: { event: made.app } }), /needs an event/);
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'defers', from: made.app, to: made.hover }], reason: 'test' }), /must start from occurrence/);
  const listed = (await call(l, human, 'view', { name: 'gate', params: {} })) as { events: { id: string }[] };
  assert.deepEqual(listed.events.map((e) => e.id), [made.release]);
});

