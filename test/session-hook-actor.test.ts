// The sessions pack's hooks act as the agent the claude_code pack's adapter names (reach.server.adapter.before.actor):
// the sessions pack keeps the name itself, since it imports nothing of another pack; this says the two agree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_ACTOR, HOOK_AGENT } from '../src/session-hook.ts';

test("the sessions pack's hooks act as the agent claude_code's adapter names", () => {
  assert.deepEqual(HOOK_AGENT, HOOK_ACTOR);
});
