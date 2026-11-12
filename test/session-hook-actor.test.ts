// The sessions pack's hooks act as the agent the claude_code pack's adapter names (reach.server.adapter.before.actor):
// the sessions pack keeps the name itself, since it imports nothing of another pack; this says the two agree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_ACTOR, HOOK_AGENT } from '../src/session-hook.ts';

test("the sessions pack's hooks act as the agent claude_code's adapter names", () => {
  assert.deepEqual(HOOK_AGENT, HOOK_ACTOR);
});

test("the working rules say what the agents pack's said says of the presets, for every pack this checkout has", async () => {
  const { presetsOf } = await import('../src/declared.ts');
  const { said } = await import('../src/instructions.ts');
  const { checkoutPacks, presetsSaid } = await import('../src/working-rules.ts');
  const presets = presetsOf(checkoutPacks(), 'instruction');
  assert.ok(presetsSaid(presets, 'working_rules').length > 0);
  assert.deepEqual(presetsSaid(presets, 'working_rules'), said(presets, [], 'working_rules').map(({ title, text }) => ({ title, text })));
});
