// A surface's hooks translated by the server pack that declares it (task e_chb65gx7): the kernel says what a session is
// told, neutrally, and the pack puts it in the surface's shape. /hooks/<event> is Claude Code's, the claude_code pack's.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookAt } from '../src/server-adapter.ts';
import { loadServerPacks } from '../src/server-packs.ts';
import { serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs', 'adapter');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => void delete process.env.PELAGO_SERVER_PACKS);

test('an address under /hooks/ names an event, or a surface and its event', () => {
  assert.deepEqual(hookAt('session-start'), { event: 'session-start' });
  assert.deepEqual(hookAt('rover/begin'), { surface: 'rover', event: 'begin' });
});

test('two packs cannot translate one surface', () => {
  const { packs } = loadServerPacks([FIXTURES]);
  assert.deepEqual(packs.filter((p) => p.file.reach.server.adapter).map((p) => p.file.reach.server.adapter!.surface), ['rover']);
});

test('a surface’s hooks are answered in its own shape; Claude Code’s as before; a surface no pack translates is not answered', async () => {
  const { call } = await serve('off');
  const hook = (path: string, body: unknown) => call(path, undefined, body, 'POST');

  const begun = await hook('/hooks/rover/begin', { sid: 'rover-1', dir: process.cwd() });
  assert.equal(begun.status, 200);
  assert.equal(begun.on, 'begin');
  assert.equal(typeof begun.context, 'string');
  assert.ok(begun.context.length > 0, 'the kernel told the session where it stands');
  assert.equal(begun.hookSpecificOutput, undefined, 'not in Claude Code’s shape');

  // A hook the pack does not hand to the kernel is still answered by the pack, with nothing told.
  assert.deepEqual(await hook('/hooks/rover/ping', {}), { status: 200, on: 'ping', kernel: null });
  // A turn's end with no rule asking to go on: nothing told.
  assert.deepEqual(await hook('/hooks/rover/turn', { sid: 'rover-1' }), { status: 200, on: 'turn', kernel: 'stop' });

  const claude = await hook('/hooks/session-start', { session_id: 'cc-1', cwd: process.cwd() });
  assert.equal(claude.status, 200);
  assert.equal(claude.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(typeof claude.hookSpecificOutput.additionalContext, 'string');

  // A surface no pack translates is gone, as a pack's route is once the pack is.
  assert.equal((await hook('/hooks/nobody/begin', {})).status, 410);
});
