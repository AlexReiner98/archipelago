import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { phasesOf } from '../src/phases.ts';

test('a status unsaid is read from its place; a lone open status stands, and what stands ends', () => {
  assert.deepEqual(phasesOf({ open: ['todo', 'doing'], closed: ['done', 'dropped'] }, []), { todo: 'not_started', doing: 'under_way', done: 'finished', dropped: 'ended' });
  assert.deepEqual(phasesOf({ open: ['current'], closed: ['retired'] }, []), { current: 'standing', retired: 'ended' });
  assert.deepEqual(phasesOf({ open: ['open'], closed: ['decided'] }, [undefined, { open: 'not_started' }]), { open: 'not_started', decided: 'finished' }, 'an ancestor says the same word');
});

test('every type of every pack gives each status a phase, as its pack says', () => {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  for (const t of (reg as unknown as { types: Map<string, { id: string; statuses: { open: string[]; closed: string[]; phases?: Record<string, string> } }> }).types.values())
    for (const s of [...t.statuses.open, ...t.statuses.closed]) assert.ok(t.statuses.phases?.[s], `${t.id} ${s}`);
  const of = (type: string) => reg.type(type)!.statuses.phases;
  assert.deepEqual(of('run'), { running: 'under_way', waiting: 'under_way', finished: 'finished', failed: 'trouble', cancelled: 'ended' });
  assert.equal(of('task')!.todo, 'not_started');
  assert.equal(of('person')!.active, 'standing');
  assert.equal(of('decision')!.open, 'not_started');
  assert.deepEqual(of('aim'), { active: 'standing', achieved: 'finished', retired: 'ended' }, 'an aim achieved is finished, as its pack says');
});
