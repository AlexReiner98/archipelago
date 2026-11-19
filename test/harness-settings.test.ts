// What the map may write into a checkout (task e_55yajsbf): a CLAUDE.md, a CLAUDE.local.md, a skill. An agent's
// instruction for any other file (Claude Code's settings, permissions, hooks) is refused, holds off or on: those decide
// what an agent may run unasked, and stay the owner's (core's rule agent_harness_settings).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import type { Actor, Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };
const maps: Archipelago[] = [];
after(() => maps.forEach((l) => hostFor(l.registry).stop()));

const instruction = (path: string, remote = 'o/r') => ({ op: 'create', type: 'instruction', title: `For ${path}`, body: 'Words.', props: { for: ['session_start', `written:${path}`], remote } });

test("an agent writes a repository's instructions and a skill from the map, and never its settings, holds off or on", async () => {
  const l = await fresh();
  maps.push(l);
  await callTool(l, owner, 'workspace_set', { holds_off: true });
  for (const path of ['CLAUDE.md', 'CLAUDE.local.md', '.claude/skills/pelago-bump/SKILL.md']) {
    const made = (await callTool(l, agent, 'change', { reason: 'test', ops: [instruction(path)] })) as { status: string };
    assert.equal(made.status, 'applied', path);
  }
  for (const path of ['.claude/settings.json', '.claude/settings.local.json', '.claude/pelago-hook.mjs', '../CLAUDE.md', 'CLAUDE.md.bak']) {
    await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [instruction(path)] }), /settings, permissions and hooks/, path);
  }
  // The owner may keep one on the map, as a note of what they set by hand: it is still written nowhere.
  const theirs = (await callTool(l, owner, 'change', { reason: 'test', ops: [instruction('.claude/settings.json')] })) as { status: string };
  assert.equal(theirs.status, 'applied');
});
