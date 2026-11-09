import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { heldResources } from '../src/blocking.ts';
import { configureLauncher, launch } from '../src/launcher.ts';
import { Archipelago } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { configureSecrets, isSealed, seal, unseal } from '../src/secrets.ts';
import { recordUsage, sessionStart, sessionUpdate } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { askView } from '../src/askview.ts';
import { human, agent, fresh, freshWith, make, packsWith } from './map.ts';

/** A place found by its folder and its remote, as a repository is: what launching and a run's report look for. */
const YARD: PackFile = {
  id: 'yard', version: '1', title: 'Yard', requires: ['core'],
  types: [{ id: 'yard.checkout', title: 'Checkout', description: '', extends: 'place', fields: { path: { type: 'string' }, remote: { type: 'url' } }, capabilities: { where: { address: 'remote', folder: 'path' } } }],
};
const withYard = () => freshWith(new Registry(packsWith(YARD)));

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('a note can name what the same change makes, and an agent can ask for its change to be held', async () => {
  const l = await fresh();
  const { note } = await make(l, [{ op: 'create', ref: 'note', type: 'finding', title: 'Handoff', body: 'Open: nothing.' }]);
  const made = await make(l, [
    { op: 'update', id: note, append: 'Next: {t}, as {t} says. Not a ref: {x} and { t }.' },
    { op: 'create', ref: 't', type: 'task', title: 'Connect the repository', body: 'Written up in {t} itself.' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Before {t}?' },
  ]);
  assert.match(made.t, /^e_\w{8}$/);
  // The id is there though the note was written before the item it names, and other braces are left as they were.
  assert.equal((await l.entity(note))!.body, `Open: nothing.\n\nNext: ${made.t}, as ${made.t} says. Not a ref: {x} and { t }.`);
  assert.equal((await l.entity(made.t))!.body, `Written up in ${made.t} itself.`);
  assert.equal((await l.entity(made.q))!.title, `Before ${made.t}?`);
  // Held, a change keeps its refs as written, and they become ids when it is applied.
  const held = (await l.change(agent, { ops: [{ op: 'create', ref: 'n', type: 'finding', title: 'Later', body: 'This is {n}.' }], reason: 'test' })) as any;
  const applied = (await l.decide(human, { proposal: held.proposal, approve: true })) as any;
  assert.equal((await l.entity(applied.created.n))!.body, `This is ${applied.created.n}.`);

  // Where agents' changes are applied as made, one that asks to be held waits for the human all the same.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto' });
  assert.equal((await free.change(agent, { ops: [{ op: 'update', id: made.t, status: 'doing' }], reason: 'test' })).status, 'applied');
  const asked = await free.change(agent, { ops: [{ op: 'update', id: made.t, status: 'done' }], reason: 'Have a look first', hold: true });
  assert.equal(asked.status, 'proposed');
  assert.equal((await l.entity(made.t))!.status, 'doing');
  assert.equal((await free.change(human, { ops: [{ op: 'update', id: made.t, status: 'done' }], reason: 'test', hold: true })).status, 'applied', 'a human\'s own change is never held');

  // An agent names a thing in a few words: a sentence for a title is refused, on a new thing or an old one. A person names as they like.
  const sentence = 'A session finds its repository by its GitHub address, not by a folder path on one machine';
  await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: sentence }] }), /op 1 \(create\): the title is 89 characters\. A title is a name, not a sentence: 60 at most/);
  await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: made.t, title: sentence }] }), /op 1 \(update\): the title is 89 characters/);
  assert.equal(((await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Find a repository by its remote' }] })) as any).status, 'proposed');
  assert.equal(((await callTool(l, human, 'change', { reason: 'test', ops: [{ op: 'update', id: made.t, title: sentence }] })) as any).status, 'applied');
});

test('a secret is sealed with a key that is not in the database, and without that key it reads as not set', async () => {
  const l = await fresh();
  const dir = mkdtempSync(join(tmpdir(), 'pelago-secrets-'));
  configureSecrets(dir);
  await l.setSecret('github_secret', 'whsec-of-the-first-server');
  const stored = (await l.setting<string>('github_secret'))!;
  assert.ok(isSealed(stored) && !stored.includes('whsec'));
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  assert.notEqual(seal('the same words'), seal('the same words'), 'sealed twice, the same secret does not look the same');
  // The key is a file beside the workspaces, made on first use, and is what opens it after a restart.
  assert.equal(Buffer.from(readFileSync(join(dir, 'secrets.key'), 'utf8').trim(), 'base64').length, 32);
  configureSecrets(dir);
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  // A key given in the environment is used for what is sealed from then on; what the file sealed still opens.
  process.env.PELAGO_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  await l.setSecret('anthropic_key', 'sk-ant-kept-out-of-the-disk');
  assert.equal(await l.secret('anthropic_key'), 'sk-ant-kept-out-of-the-disk');
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  // On a server with neither key (a backup restored somewhere else), it cannot be opened: it reads as not set, and nothing is given away.
  delete process.env.PELAGO_SECRETS_KEY;
  configureSecrets(mkdtempSync(join(tmpdir(), 'pelago-elsewhere-')));
  assert.equal(await l.secret('anthropic_key'), undefined);
  assert.equal(await l.secret('github_secret'), undefined);
  // Tampered with, a sealed value does not open either.
  configureSecrets(dir);
  assert.equal(unseal(stored.slice(0, -4) + 'AAAA'), undefined);
  // Nor with part of its tag: the first four bytes of the right one are not the right one.
  const [iv, tag, sealedBody] = stored.slice('sealed:v1:'.length).split(':');
  assert.equal(unseal(`sealed:v1:${iv}:${Buffer.from(tag, 'base64').subarray(0, 4).toString('base64')}:${sealedBody}`), undefined);
  await l.setSecret('github_secret', undefined);
  assert.equal(await l.setting('github_secret'), undefined);
  configureSecrets(null);
});

test('launching runs a headless session on a task, holding the lane and recording the outcome', async () => {
  const l = await withYard();
  const dir = mkdtempSync(join(tmpdir(), 'pelago-launch-'));
  // A stand-in for the Claude Code CLI: echoes what it was given, as stream-json.
  const cli = join(dir, 'fake-claude.mjs');
  writeFileSync(
    cli,
    `let prompt = '';
     process.stdin.on('data', (d) => (prompt += d)).on('end', () => {
       const say = (m) => console.log(JSON.stringify(m));
       say({ type: 'system', subtype: 'init', session_id: process.argv[process.argv.indexOf('--session-id') + 1] });
       if (prompt.includes('PLANONLY')) {
         say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: 'The plan: do X then Y' } }] } });
         return setTimeout(() => say({ type: 'result', is_error: false, result: '', num_turns: 2 }), 100);
       }
       setTimeout(() => say({ type: 'result', is_error: prompt.includes('FAIL'), num_turns: 3, total_cost_usd: 0.5,
         result: 'mode=' + process.argv[process.argv.indexOf('--permission-mode') + 1] + ' cwd=' + process.cwd() + ' saw=' + prompt.includes('# Capture probe') + '/' + prompt.includes('cannot edit files') }), 300);
     });`,
  );
  configureLauncher({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), command: [process.execPath, cli] });
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Repo', props: { path: dir } },
    { op: 'create', ref: 'proj', type: 'aim', title: 'Proj' },
    { op: 'create', ref: 'lane', type: 'place', props: { exclusive: true }, title: 'Live lane' },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'homeless', type: 'task', title: 'No repo' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
  ]);
  const ended = async (run: string) => {
    for (let i = 0; i < 100; i++) {
      const e = (await l.entity(run))!;
      if (!e.is_open) return e;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the launched session never ended');
  };

  await assert.rejects(launch(l, agent, { task: made.live }), /Only a human/);
  await assert.rejects(launch(l, human, { task: made.homeless }), /not linked to a repository/);

  const first = await launch(l, human, { task: made.live });
  assert.deepEqual([first.mode, first.claimed], ['plan', ['Live lane']]);
  // While it runs it holds the lane, so a second launch on the same task is refused.
  await assert.rejects(launch(l, human, { task: made.live }), /Not launched\. "Live lane" is held by "Headless \(plan\): Capture probe"/);

  const done = await ended(first.run);
  assert.equal(done.status, 'finished');
  assert.match(done.body, /mode=plan/);
  assert.match(done.body, /saw=true\/true/, 'the prompt carried the brief and the mode note');
  assert.match(done.body, /3 turns, \$0\.50; transcript: /);
  assert.ok(done.body.toLowerCase().includes(`cwd=${dir}`.toLowerCase()), 'it ran in the repository');
  assert.match(readFileSync((first as { transcript: string }).transcript, 'utf8'), /"type":"result"/);
  assert.equal((await heldResources(l)).length, 0, 'the lane came back');

  const planned = await ended((await launch(l, human, { task: made.live, instructions: 'PLANONLY' })).run);
  assert.match(planned.body, /finished: The plan: do X then Y/, 'a plan-mode answer is found even though the result is empty');

  const failing = await launch(l, human, { task: made.live, mode: 'acceptEdits', instructions: 'please FAIL' });
  const failed = await ended(failing.run);
  assert.equal(failed.status, 'failed');
  assert.match(failed.body, /mode=acceptEdits/);

  // Started by someone other than the owner, or by an automation, a session only proposes, and its run says who.
  configureLauncher({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), command: [process.execPath, cli], auth: true });
  const people = await make(l, [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann' }, { op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(people.ann)]);
  const mayOf = async (run: string) => (await l.db.query<{ may: string }>(`select may from token where name = $1`, [`launched:${run}`])).rows[0]?.may;
  const owners = await launch(l, { kind: 'human', name: 'ann', person: people.ann }, { task: made.live });
  assert.deepEqual([await mayOf(owners.run), (await l.entity(owners.run))!.props.started_by], ['change', undefined], 'the owner’s own launch changes as any agent may');
  await ended(owners.run);
  const bos = await launch(l, { kind: 'human', name: 'bo', person: people.bo }, { task: made.live });
  assert.deepEqual([await mayOf(bos.run), (await l.entity(bos.run))!.props.started_by], ['propose', { kind: 'person', id: people.bo, name: 'bo' }]);
  await ended(bos.run);
  const nightly = await launch(l, { kind: 'human', name: 'automation:e_auto0001' }, { task: made.live }, { kind: 'automation', id: 'e_auto0001', name: 'Nightly' });
  assert.deepEqual([await mayOf(nightly.run), ((await l.entity(nightly.run))!.props.started_by as { kind: string }).kind], ['propose', 'automation']);
  await ended(nightly.run);
});

test('tokens: an estimate is asked for, what a session uses goes to its work, and the graph adds up what is part of what', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Proj' },
    { op: 'create', ref: 'f', type: 'task', title: 'Feature', props: { tokens_estimated: 100_000 } },
    { op: 'create', ref: 'a', type: 'task', title: 'Task A', props: { tokens_estimated: 80_000 } },
    { op: 'create', ref: 'b', type: 'task', title: 'Task B' },
    { op: 'create', ref: 'n', type: 'finding', title: 'A note' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'f' },
    { op: 'link', type: 'part_of', from: 'b', to: 'f' },
    { op: 'link', type: 'about', from: 'n', to: 'p' },
  ]);
  const { run } = await sessionStart(l, agent, { session_id: 's1', title: 'Counting' });
  const before = (await l.entity(made.b))!.updated_at;
  // Used with nothing taken on: the session keeps it.
  assert.deepEqual(await recordUsage(l, 's1', 10_000), { run, added: 10_000, to: [] });
  assert.match(((await sessionUpdate(l, agent, { run, task: made.b })) as any).estimate, /"Task B" has no estimate.*tokens_estimated/);
  assert.equal(((await sessionUpdate(l, agent, { run, task: made.a })) as any).estimate, undefined, 'one with an estimate is not asked about');
  // The count is the session's total: only what is new is shared between what it is on.
  assert.deepEqual((await recordUsage(l, 's1', 50_000))!.added, 40_000);
  assert.equal((await recordUsage(l, 's1', 50_000))!.added, 0, 'the same count again adds nothing');
  assert.equal(await recordUsage(l, 'nobody', 5), undefined);
  const props = async (id: string) => (await l.entity(id))!.props;
  assert.deepEqual([(await props(run)).tokens_used, (await props(made.a)).tokens_used, (await props(made.b)).tokens_used], [50_000, 20_000, 20_000]);
  assert.deepEqual((await l.entity(made.b))!.updated_at, before, 'measuring does not make the work look newly confirmed');

  const nodes = new Map(((await ask(l, 'graph', { focus: made.p, depth: 1, relations: 'all', include_closed: true })) as any).nodes.map((n: any) => [n.title, n]));
  const of = (title: string) => nodes.get(title) as any;
  assert.deepEqual(of('Proj').tokens, { estimated: 80_000, used: 40_000, partial: true }, 'a project is what is part of it, in sight or not');
  assert.deepEqual([of('Feature').tokens, of('Feature').estimated], [{ estimated: 80_000, used: 40_000, partial: true }, true], 'a feature is the sum of its tasks, and says when some of them have no estimate');
  assert.deepEqual([of('A note').work, of('A note').tokens], [undefined, undefined], 'what is not work has no tokens');
  // A task linked to its feature and to the project as well is counted once, and a note that is part of a feature is not work.
  await make(l, [{ op: 'link', type: 'part_of', from: made.a, to: made.p }, { op: 'link', type: 'part_of', from: made.n, to: made.f }]);
  const once = ((await ask(l, 'graph', { focus: made.p, depth: 1, relations: 'all', include_closed: true })) as any).nodes;
  assert.deepEqual(once.find((n: any) => n.id === made.p).tokens, { estimated: 80_000, used: 40_000, partial: true });
  // What is finished counts as used: by its estimate when no session was measured on it, and its feature and project with it.
  const { c } = await make(l, [{ op: 'create', ref: 'c', type: 'task', title: 'Task C', status: 'done', props: { tokens_estimated: 30_000 } }, { op: 'link', type: 'part_of', from: 'c', to: made.f }]);
  const again = ((await ask(l, 'graph', { focus: made.f, depth: 1, relations: 'all', include_closed: true })) as any).nodes;
  assert.deepEqual(again.find((n: any) => n.id === c).tokens, { estimated: 30_000, used: 30_000, assumed: true });
  assert.deepEqual(again.find((n: any) => n.id === made.f).tokens, { estimated: 110_000, used: 70_000, assumed: true, partial: true });
  // Its own estimate stands only while none of its tasks has one.
  const { g } = await make(l, [{ op: 'create', ref: 'g', type: 'task', title: 'Bare', props: { tokens_estimated: 50_000 } }, { op: 'create', ref: 'x', type: 'task', title: 'Unsized' }, { op: 'link', type: 'part_of', from: 'x', to: 'g' }]);
  assert.deepEqual(((await ask(l, 'graph', { focus: g, depth: 1, relations: 'all', include_closed: true })) as any).nodes.find((n: any) => n.id === g).tokens, { estimated: 50_000, used: 0 });
  await make(l, [{ op: 'archive', id: c }]);
  await make(l, [{ op: 'update', id: made.b, props: { tokens_estimated: 70_000 } }]);
  assert.equal(((await ask(l, 'graph', { focus: made.f, depth: 1, relations: 'all', include_closed: true })) as any).nodes.find((n: any) => n.id === made.f).tokens.estimated, 150_000);
});

test('a run in GitHub Actions reports what it used, once', async () => {
  const l = await withYard();
  const { repo } = await make(l, [{ op: 'create', ref: 'repo', type: 'yard.checkout', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git', path: 'C:\\code\\site' } }]);
  const told = { repo: 'acme/site', title: 'Read the push to main (abc1234)', tokens: 42_000.4, cost_usd: 0.31337, turns: 9, link: 'https://github.com/acme/site/actions/runs/1', summary: 'Closed one task.' };
  const first = (await callTool(l, agent, 'run_report', told)) as any;
  assert.equal(first.recorded, true);
  assert.deepEqual(await callTool(l, agent, 'run_report', told), { run: first.run, recorded: false }, 'told twice, recorded once');
  await callTool(l, agent, 'run_report', { repo, title: 'Scheduled re-check', ok: false, tokens: 8_000, link: 'https://github.com/acme/site/actions/runs/2' });
  await assert.rejects(callTool(l, agent, 'run_report', { repo: 'acme/other', title: 'x' }), /No repository "acme\/other"/);
  const run = (await l.entity(first.run))!;
  assert.deepEqual([run.type, run.status, run.is_open, run.props.surface, run.props.tokens_used, run.props.cost_usd, run.props.turns, run.body], ['run', 'finished', false, 'github-actions', 42_000, 0.3134, 9, 'Closed one task.']);
  assert.equal((await l.proposals()).length, 0, 'a report is not a change to review');
});
