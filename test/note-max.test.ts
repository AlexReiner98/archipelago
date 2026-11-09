// A type may hold its note to a length an agent cannot grow past (note_max): a note every session reads whole is
// kept short, and an agent that goes over is told to rewrite it, never to keep appending. A person is not held.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, human, make, PACKS } from './map.ts';

const SAY = 'Rewrite it whole with body: keep what is still so.';

test('a note held to a length is not grown past it by an agent, only rewritten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-note-max-'));
  cpSync(PACKS, dir, { recursive: true });
  mkdirSync(join(dir, 'held'));
  writeFileSync(join(dir, 'held', 'pack.json'), JSON.stringify({
    id: 'held', version: '1', title: 'Held', requires: ['core'],
    types: [{ id: 'brief_note', extends: 'record', title: 'Brief', description: 'A note every session reads whole.', note_max: { chars: 3000, say: SAY } }],
  }));
  const l = await freshWith(new Registry(dir));
  const { brief: note } = await make(l, [{ op: 'create', ref: 'brief', type: 'brief_note', title: 'Apex brief', body: 'Next\nRun the probe.' }]);
  const part = 'Next, and why\n' + 'Run the probe on a real model. '.repeat(40);
  for (let i = 0; i < 4; i++) await l.change(human, { reason: 'test', ops: [{ op: 'update', id: note, append: part }] });
  await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: note, append: part }] }), /the brief note would be \d+ characters: 3000 at most[^]*Rewrite it whole/);
  const shorter = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: note, body: 'Next, and why\nRun the probe on a real model.' }] })) as { status: string };
  assert.ok(['applied', 'proposed'].includes(shorter.status));
});
