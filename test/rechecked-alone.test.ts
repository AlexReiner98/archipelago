// The open core alone keeps no scheduled re-checks (the software pack's recheck view, 9 Nov 2026: the packs leave for
// the hosted service): saying one was done is refused in words, not with a missing view.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, PACKS } from './map.ts';

test('rechecked on a map whose packs keep no re-checks says so', async () => {
  const l = await freshWith(new Registry(PACKS, ['core']));
  await assert.rejects(callTool(l, agent, 'rechecked', { repo: 'anything' }), /No pack here keeps scheduled re-checks/);
});
