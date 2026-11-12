// A pack's tool declares its input as a JSON shape and the surface builds its zod schema (packs/surface/kernel/
// tool-input.ts): what an agent is told of each such tool (query actions, the MCP list) is what it was told when the
// tool's input was written in zod. The fixture holds each tool's JSON schemas as they were before it moved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { inputOf } from '../packs/surface/kernel/tool-input.ts';
import { TOOLS } from '../packs/surface/kernel/tools.ts';

const PINNED = JSON.parse(readFileSync(new URL('./fixtures/pack-tool-schemas.json', import.meta.url), 'utf8')) as Record<string, unknown>;

test('every tool whose input moved to a JSON shape tells an agent what it told before', () => {
  for (const [name, was] of Object.entries(PINNED)) {
    const t = TOOLS[name];
    assert.ok(t, `${name} is still a tool`);
    assert.deepEqual({ description: t.description, humanOnly: !!t.humanOnly, object: z.toJSONSchema(z.object(t.input)), strict: z.toJSONSchema(z.strictObject(t.input)) }, was, name);
  }
});

test('a shape is checked as it is built, and an input is checked by what it builds', () => {
  const input = z.strictObject(inputOf({ id: 'id', 'n?': 'number', 'tags?': ['string'], 'of?': ['human', 'agent'], 'at?': { 'x?': 'any' } }, { id: 'The item.' }));
  assert.equal(input.safeParse({ id: 'e_aaaaaaaa', n: 2, tags: ['a'], of: 'agent', at: { x: [1] } }).success, true);
  for (const bad of [{}, { id: 1 }, { id: 'e', of: 'system' }, { id: 'e', tags: [1] }, { id: 'e', extra: true }]) assert.equal(input.safeParse(bad).success, false, JSON.stringify(bad));
  assert.throws(() => inputOf({ id: 'text' }), /"text" is no shape/);
  assert.throws(() => inputOf({ ids: ['string', 'up'] }), /a list's shape is one shape/);
  // A string of one character or more, and a value of one of two scalar shapes: the hook tool's session_id and stop_hook_active.
  const hook = z.strictObject(inputOf({ session_id: 'nonempty', 'on?': ['boolean', 'string'] }));
  for (const good of [{ session_id: 's' }, { session_id: 's', on: true }, { session_id: 's', on: 'true' }]) assert.equal(hook.safeParse(good).success, true, JSON.stringify(good));
  for (const bad of [{ session_id: '' }, { session_id: 's', on: 1 }]) assert.equal(hook.safeParse(bad).success, false, JSON.stringify(bad));
});
