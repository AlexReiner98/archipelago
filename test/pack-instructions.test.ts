// What an agent is told names only what its workspace's packs have: on a map with only the core pack, the rules file,
// the MCP server's words, the tools' descriptions and what a session is told at its start name no type, field, view
// or link another pack declares, so a careful agent is not refused for following them (finding e_jccrcj7b).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parts } from '../src/manifest.ts';
import { connectText } from '../src/mcp.ts';
import { Registry } from '../src/packs.ts';
import { hookSessionStart } from '../src/session-hook.ts';
import { surfaceFor } from '../src/tools.ts';
import { workingRules } from '../src/working-rules.ts';
import { freshWith, PACKS, packsWith } from './map.ts';

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** Every name a registry knows: its types, their fields, its links and its views. */
function namesOf(reg: Registry): Set<string> {
  const names = new Set<string>();
  for (const [id, t] of reg.types) [id, ...Object.keys(t.fields ?? {})].forEach((n) => names.add(n));
  for (const id of reg.relations.keys()) names.add(id);
  for (const pack of reg.packs) for (const v of parts(pack).views) names.add(short(v.id));
  return names;
}

/** What the kernel's own actions take, though a pack's field has the same name: session_start's remote. */
const INPUTS = new Set(['remote']);

/** The names another pack has and core lacks, as they appear in a text: in backticks, or after a word that introduces one. */
function lacking(text: string, lacks: Set<string>): string[] {
  const named = [...text.matchAll(/`([a-z_]+)`|\b(?:type|types|name|view|field|link|linked|as an?) ([a-z_]+)\b/g)].map((m) => m[1] ?? m[2]);
  return [...new Set(named.filter((n) => lacks.has(n) && !INPUTS.has(n)))];
}

/** Names other packs have (the software and work packs, which live outside this repository): core has none of them. */
const ELSEWHERE = ['issue', 'hub_at', 'handoff', 'repo', 'repo_work', 'traps', 'based_on'];

test('a core-only map is told nothing it lacks: rules, MCP words, tools and the session start', async () => {
  const core = new Registry(PACKS, ['core']);
  const have = namesOf(core);
  for (const n of ELSEWHERE) assert.ok(!have.has(n), `${n} is not core's`);
  const lacks = new Set(ELSEWHERE);
  assert.deepEqual(lacking('Read with query: name handoff with repo. Record it as an issue; set its `hub_at` to 1.', lacks).sort(), ['handoff', 'hub_at', 'issue']);

  const rules = workingRules(core.packs);
  assert.deepEqual(lacking(rules, lacks), [], 'the rules file');
  // A lens's fields, as the rules name them, are a lens's: not kinds, far, controls or from, which no lens has.
  const lens = core.type('lens')!.fields;
  const held = /holding its query\s+\(([^)]*)\)\s+and how it is drawn\s+\(([^)]*)\)/.exec(rules)!;
  for (const field of `${held[1]},${held[2]}`.match(/[a-z_]+/g)!) assert.ok(lens[field], `a lens has ${field}`);
  assert.deepEqual(lacking(connectText(core), lacks), [], 'the MCP server text');
  assert.match(connectText(core), /name frontier for where this session stands, brief with task/);
  assert.doesNotMatch(connectText(core), /handoff/);
  for (const [name, tool] of surfaceFor(core)) assert.deepEqual(lacking(tool.description, lacks), [], `the ${name} tool`);

  const l = await freshWith(core);
  const start = await hookSessionStart(l, { session_id: 'core-only', cwd: 'C:\\code\\new' });
  assert.deepEqual(lacking(start, lacks), [], 'the session start');
  assert.match(start, /a finding about the item it concerns/, 'a bump is a finding, in core');
  assert.doesNotMatch(start, /repository|as an issue/);
});

/** A small pack of the work pack's shape: its own issue type, and its word on bumps in place of core's. */
const TRACKER = {
  id: 'tracker',
  version: '0.1.0',
  title: 'Tracker',
  description: 'A pack for testing that a pack’s instruction stands in for core’s.',
  requires: ['core'],
  types: [{ id: 'issue', title: 'Issue', description: 'Something wrong.', extends: 'work' }],
  styles: [{ id: 'tracker.bumps', type: 'instruction', title: 'Record what gets in the way', body: 'When Archipelago itself gets in your way, record it on the map as an issue when it happens.', props: { for: ['session_start'], order: 30, replaces: 'core.bumps' } }],
};

test('with its pack on, a pack says it in its own types: its bump is an issue, in place of core’s', async () => {
  const l = await freshWith(new Registry(packsWith(TRACKER as never)));
  const start = await hookSessionStart(l, { session_id: 'tracker', cwd: 'C:\\code\\new' });
  assert.match(start, /record it on the map as an issue/);
  assert.doesNotMatch(start, /a finding about the item it concerns/, 'core’s wording is replaced, not said beside it');
});

test('a link refused for its ends says which links do join them', () => {
  const reg = new Registry(PACKS, ['core']);
  const why = reg.checkRelation('bears_on', 'task', 'task')!;
  assert.match(why, /"bears_on" must point to question, not task; from task to task, use .*\babout\b/);
});
