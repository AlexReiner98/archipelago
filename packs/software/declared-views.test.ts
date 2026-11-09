// What this pack shows of one item is a view of it, not a screen: a lens preset on its type, the item where it says
// {here}. Read from the schema through the tools (#pelago/test), so it runs wherever the pack lives.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { call, human, mapWith } from '#pelago/test';

type Described = { screens: { id: string }[]; canvases: { id: string; pack: string; on?: string[]; props: { filter: { find: string[] } } }[] };

test('the roadmap is a lens preset on a project, and the screens views replaced are gone', async () => {
  const l = await mapWith(join(import.meta.dirname, '..'));
  const schema = await call<Described>(l, human, 'schema', {});
  const roadmap = schema.canvases.find((c) => c.id === 'software.roadmap')!;
  assert.deepEqual([roadmap.pack, roadmap.on, roadmap.props.filter.find], ['software', ['project'], ['in {here}']]);
  assert.ok(!schema.screens.some((s) => ['software.roadmap', 'software.gate', 'software.proof', 'software.usage', 'software.releases', 'time.today', 'time.invoices', 'science.undermined'].includes(s.id)), 'the screens their views replace are gone');
});
