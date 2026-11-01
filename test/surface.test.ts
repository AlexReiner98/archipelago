// The small surface for agents (Rule 7): query, change, undo, the six verbs and draw are all MCP offers, every tool an
// agent called before answers by its old name for one release with the call that replaces it, and a session's work
// is done through the ten alone.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { canAsk } from '../src/askview.ts';
import { QUERY_READS, route, SURFACE } from '../src/surface.ts';
import { callTool, replacementOf, surfaceFor, TOOLS } from '../src/tools.ts';
import { agent, fresh } from './map.ts';
import { closers, serve } from './serve.ts';

/** Every tool an agent was offered before the surface was made small (main at 391a4be), and Kuma's old name. */
const OLD = [
  'schema', 'search', 'get', 'view', 'events', 'proposals', 'backup', 'watch', 'show', 'claim', 'release', 'session_start', 'session_update',
  'tell', 'run_report', 'picture_put', 'picture', 'session_end', 'notify', 'check_connections', 'rechecked', 'import_audit', 'packs', 'acts',
  'document', 'publish', 'publish_all', 'publish_plan', 'publish_ask', 'published', 'share_figure', 'backup_download', 'confirmed', 'restart',
  'health_report', 'software_test_report', 'software_handoff', 'software_gate', 'software_repo_work', 'software_recheck', 'software_proof',
  'software_changelog', 'software_agent_usage', 'inquiry_undermined', 'money_costs', 'reader_recheck', 'time_log', 'time_invoice_draft',
  'time_invoice_paid', 'time_invoice_void', 'time_today', 'time_timesheet', 'time_week',
];

test('the surface is exactly query, change, undo, the six verbs and draw, over MCP too', async () => {
  const l = await fresh();
  assert.deepEqual(SURFACE, ['query', 'change', 'undo', 'capture', 'assign', 'report', 'ask', 'settle', 'revise', 'draw']);
  assert.deepEqual(surfaceFor(l.registry).map(([name]) => name), SURFACE);
  assert.deepEqual(l.registry.verbs.map((v) => v.id), SURFACE.slice(3, -1), 'a verb tool for each verb the core pack declares');

  const { base } = await serve('off');
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  closers.push(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), SURFACE);
  const found = await client.callTool({ name: 'query', arguments: { name: 'search', params: { q: 'anything' } } });
  assert.ok(!found.isError, 'a read through query');
});

test('the tool list stays small, and what it leaves out is one call away', async () => {
  const { base } = await serve('off');
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  closers.push(() => client.close());
  const { tools } = await client.listTools();
  const size = JSON.stringify(tools).length;
  assert.ok(size < 12_000, `the list is ${size} characters, and every request pays for it`);

  const words = (answer: unknown) => (answer as { content: { text: string }[] }).content[0].text;
  const query = tools.find((t) => t.name === 'query')!.description!;
  for (const read of QUERY_READS) assert.ok(query.includes(`${read} (`), `${read} is named with its params`);
  const said = async (args: Record<string, unknown>) => JSON.parse(words(await client.callTool({ name: 'query', arguments: args })));
  assert.match((await said({})).views.flat, /The filter is/, 'the query’s terms are in the list of names');
  assert.match((await said({ name: 'actions', params: { read: 'flat' } })).description, /The filter is/, 'one view’s text, alone');
  assert.ok((await said({ name: 'actions', params: { read: 'search' } })).params.properties.q, 'a read says its params');
  assert.match(words(await client.callTool({ name: 'query', arguments: { name: 'actions', params: { read: 'nothing' } } })), /No read or view "nothing"/);
  const [change] = await said({ name: 'actions', params: { action: 'change' } });
  assert.equal(change.params.properties.ops.items.oneOf.length, 9, 'every op, whole');

  const listed = tools.find((t) => t.name === 'change')!;
  for (const op of ['create', 'update', 'link', 'unlink', 'archive', 'restore', 'merge', 'define_type', 'forget']) assert.ok(listed.description!.includes(`${op} (`), `${op} has its line`);
  const wrong = await client.callTool({ name: 'change', arguments: { reason: 'test', ops: [{ op: 'create', title: 'No type' }] } });
  assert.ok(wrong.isError, 'only the list is loose: an op is checked as it always was');
  assert.match(words(wrong), /Invalid input for change/);
  assert.ok(!(await client.callTool({ name: 'change', arguments: { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Typed' }] } })).isError);
});

test('every old name answers with its replacement, and the replacement reaches the same tool', async () => {
  const l = await fresh();
  for (const old of OLD) {
    const moved = replacementOf(l.registry, old);
    assert.ok(moved, `${old} names its replacement`);
    if (old === 'view') {
      assert.match(moved, /call query with \{ name, params \}/);
      continue;
    }
    const [, tool, key, value] = /call (\w+) with \{ (name|action): "([^"]+)"/.exec(moved) ?? [];
    assert.ok(SURFACE.includes(tool), `${old} moves to ${tool}, a tool of the surface`);
    const routed = route(l.registry, TOOLS, tool, { [key]: value, params: {} });
    assert.ok(routed, `${tool} ${value} runs a tool`);
    if (routed.name === 'view') assert.ok(canAsk(l, routed.input.name as string), `${value} is a view`);
    else assert.equal(routed.name, old === 'health_report' ? 'health' : old, `${tool} ${value} runs what ${old} ran`);
  }
  for (const stays of ['change', 'undo', 'query', 'capture', 'report']) assert.equal(replacementOf(l.registry, stays), undefined);
  assert.equal(replacementOf(l.registry, 'token_create'), undefined, 'the human’s own tools keep their names');
});

test('an old name called as plain JSON still answers, saying the call that replaces it', async () => {
  const { call } = await serve('off');
  const old = await call('/agent/search', undefined, { q: 'anything' });
  assert.equal(old.status, 200);
  assert.ok(Array.isArray(old.result), 'the answer is what it was');
  assert.match(old.moved_to, /call query with \{ name: "search"/);
  const now = await call('/agent/query', undefined, { name: 'search', params: { q: 'anything' } });
  assert.deepEqual([now.status, now.moved_to], [200, undefined]);
  assert.deepEqual(now.result, old.result);
  // Uptime Kuma posts its body as it is: a report with no action is what a system measured.
  const kuma = await call('/agent/report', undefined, { msg: 'Test' });
  assert.deepEqual([kuma.status, kuma.result.heard, kuma.moved_to], [200, true, undefined]);
});

test('an agent does a session’s work through the surface: start, change, tell, end', async () => {
  const l = await fresh();
  const start = (await callTool(l, agent, 'capture', { action: 'session_start', params: { title: 'Surface test', session_id: 'surface-1' } })) as { run: string; status: string };
  assert.equal(start.status, 'running');
  const made = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Try the surface', status: 'todo' }] })) as { status: string };
  assert.ok(['applied', 'proposed'].includes(made.status));
  const told = (await callTool(l, agent, 'report', { action: 'tell', params: { run: start.run, said: 'The ten tools are enough for a session.' } })) as { run: string };
  assert.equal(told.run, start.run);
  await callTool(l, agent, 'report', { action: 'session_update', params: { run: start.run, note: 'Halfway' } });
  const ended = (await callTool(l, agent, 'report', { action: 'session_end', params: { run: start.run, summary: 'Done', cannot_tell_rest: true } })) as { status: string };
  assert.equal(ended.status, 'finished');
  const run = (await callTool(l, agent, 'query', { name: 'get', params: { id: start.run } })) as { entity: { status: string; body: string } };
  assert.equal(run.entity.status, 'finished');
  assert.match(run.entity.body, /Halfway/);

  // An action is under one verb, and a call under another names the right one.
  await assert.rejects(callTool(l, agent, 'capture', { action: 'tell', params: {} }), /"tell" is a report: call report with action "tell"/);
  await assert.rejects(callTool(l, agent, 'report', { action: 'no_such' }), /No action "no_such"/);
  await assert.rejects(callTool(l, agent, 'report', { action: 'launch', params: { task: 'e_aaaaaaaa' } }), /is a assign|for humans only/);
  // A pack's action by its name, its tool's name or its short name.
  const verbs = (await callTool(l, agent, 'query', { name: 'actions', params: { verb: 'capture' } })) as { action: string; params: unknown }[];
  assert.ok(verbs.some((a) => a.action === 'session_start' && a.params));
  assert.ok(verbs.some((a) => a.action === 'time.log'));
  const listed = (await callTool(l, agent, 'query', {})) as { reads: Record<string, string>; views: Record<string, string> };
  assert.ok(listed.reads.get && listed.views.attention);
});

test('an agent’s instructions name only the surface: every other action by its verb', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { KERNEL_VERBS } = await import('../src/declared.ts');
  const root = join(import.meta.dirname, '..');
  const files = ['CLAUDE.md', 'examples/working-rules.md', '.claude/skills/pelago-bump/SKILL.md', 'examples/github/pelago.yml', 'src/hook-answers.ts', 'src/launcher.ts'];
  const actions = Object.keys(KERNEL_VERBS).filter((name) => !SURFACE.includes(name));
  // An action is named as code (`tell`) or by a name no sentence has (session_update): then the word before it is action.
  const named = new RegExp(`\`(${actions.join('|')})\`|\\b(${actions.filter((a) => a.includes('_')).join('|')})\\b`, 'g');
  const wrong: string[] = [];
  const { workingRules } = await import('../src/working-rules.ts');
  const texts = new Map([...files.map((file) => [file, readFileSync(join(root, file), 'utf8')] as const), ['the rules as handed out', workingRules()]]);
  for (const [file, text] of texts) {
    for (const [, tool] of text.matchAll(/mcp__pelago__([a-z_]+)/g)) if (!SURFACE.includes(tool)) wrong.push(`${file}: mcp__pelago__${tool}`);
    for (const [, tool] of text.matchAll(/`([a-z_]+)` tool\b/g)) if (!SURFACE.includes(tool)) wrong.push(`${file}: the ${tool} tool`);
    for (const m of text.matchAll(named)) if (!/action[:"`,\s]*$/.test(text.slice(Math.max(0, m.index - 12), m.index)) && !text.startsWith(' in `', m.index + m[0].length)) wrong.push(`${file}: ${m[1] ?? m[2]} without its verb`);
  }
  assert.deepEqual(wrong, []);
});
