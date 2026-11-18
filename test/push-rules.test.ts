// Rules on a push (packs/sessions/kernel/push-rules.ts): declared as data, read of the command a session is about to
// run, refusing a lane's push and a push to main by a session that does not hold main, each refusal kept on its story.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerHook } from './claude-hook.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { checkRules as checkAll } from '../packs/rules/kernel/rules.ts';
import { readPush, refusals, type RuleDef } from '../packs/sessions/kernel/push-rules.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';
import { agent, freshWith, make, PACKS } from './map.ts';

/** The two rules the build pack is handed (lane e_dpkphm84, "Rule for the build pack"), on a lane type of this test's own. */
const LANE: RuleDef = {
  id: 'lane_hands_back',
  on: 'push',
  when: { push: { works_on: 'lanes.lane' } },
  then: 'refuse',
  say: 'A lane is handed back, never pushed: set the lane handed with props.head (your last commit) and let the integration push it.',
};
const MAIN: RuleDef = {
  id: 'one_push_to_main',
  on: 'push',
  when: { push: { command: ['push', 'pr_merge'], to: 'main', lacks: 'main' } },
  then: 'refuse',
  say: 'Main takes one push at a time: claim main first (assign, action claim), and release it once /health shows the deploy.',
};
const LANES: PackFile = {
  id: 'lanes',
  version: '1',
  title: 'Lanes',
  requires: ['core'],
  types: [{ id: 'lanes.lane', title: 'Lane', description: 'A part of a feature, one session each.', extends: 'work' }],
  rules: [LANE, MAIN] as never,
};

/** The kernel's check of a pack's rules, given rules on a push (its RuleDef knows when.reply, not when.push). */
const checkRules = (rules: RuleDef[], reg: never) => checkAll(rules as never, reg);

function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-push-'));
  mkdirSync(join(dir, 'lanes'));
  writeFileSync(join(dir, 'lanes', 'pack.json'), JSON.stringify(LANES));
  return freshWith(new Registry([PACKS, dir]), { create: 'auto', update: 'auto', link: 'auto' });
}

const push = (l: Archipelago, session: string, command: string, branch = 'feature') =>
  answerHook('push', { whole: l.db, pelago: l, within: [], body: { session_id: session, cwd: '.', command, stands: { branch } }, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' }) as Promise<any>;

test('a rule on a push is checked as data', () => {
  const reg = { types: new Map([['lanes.lane', {}]]) } as never;
  assert.deepEqual(checkRules([LANE, MAIN], reg), []);
  const problems = checkRules([{ id: 'x', on: 'push', then: 'ask', when: { push: { pushed: true, command: 'force' }, op: 'create' }, say: 'one\ntwo', lifted: 'push_x' }], reg);
  for (const said of [/refuses \(then: "refuse"\)/, /reads only when.push/, /no fact "pushed"/, /command is one or more/, /one line/, /nothing lifts/]) assert.ok(problems.some((p) => said.test(p)), `${said}: ${problems.join(' | ')}`);
  assert.ok(checkRules([{ ...LANE, when: { push: { works_on: 'nobody.type' } } }], reg).some((p) => /no type "nobody.type"/.test(p)));
  assert.ok(checkRules([{ ...LANE, id: undefined }], reg).some((p) => /has an id/.test(p)));
});

test('a command is read for what it sends out, and where to', () => {
  assert.deepEqual(readPush('git push', 'feat'), [{ command: 'push', to: 'feat' }], 'no refspec: the checkout’s branch');
  assert.deepEqual(readPush('git push -u origin claude/x', 'claude/x'), [{ command: 'push', to: 'claude/x' }]);
  assert.deepEqual(readPush('git -C "some dir" push origin HEAD:main', 'feat'), [{ command: 'push', to: 'main' }]);
  assert.deepEqual(readPush('git push origin +refs/heads/a:refs/heads/main b'), [{ command: 'push', to: 'main' }, { command: 'push', to: 'b' }]);
  assert.deepEqual(readPush('npm test && gh pr create --title "A PR" --base dev'), [{ command: 'pr_create', to: 'dev' }]);
  assert.deepEqual(readPush('gh pr create --fill'), [{ command: 'pr_create', to: 'main' }], 'no base: the default branch');
  assert.deepEqual(readPush('gh pr merge 12 --squash'), [{ command: 'pr_merge', to: 'main' }]);
  assert.deepEqual(readPush('git status; git log --oneline -3'), []);
  assert.deepEqual(readPush('gh pr view 12'), []);
});

test('the rules refuse by what the session works on and holds', () => {
  const lane = { works_on: ['lanes.lane', 'work'], holds: [] };
  const lead = { works_on: ['work'], holds: ['e_main0001', 'main'] };
  assert.deepEqual(refusals([LANE, MAIN], [{ command: 'push', to: 'feat' }], lane).map((r) => r.rule.id), ['lane_hands_back']);
  assert.deepEqual(refusals([LANE, MAIN], [{ command: 'pr_create', to: 'main' }], { works_on: ['work'], holds: [] }), [], 'a pull request made does not land on main');
  assert.deepEqual(refusals([LANE, MAIN], [{ command: 'pr_merge', to: 'main' }], { works_on: ['work'], holds: [] }).map((r) => r.rule.id), ['one_push_to_main']);
  assert.deepEqual(refusals([LANE, MAIN], [{ command: 'push', to: 'main' }], lead), [], 'held, it goes');
});

test('a session on a lane is refused its push, told why, and the refusal is on its story; one holding main is let through', async () => {
  const l = await map();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'lanes.lane', title: 'Lane 2' },
    { op: 'create', ref: 'main', type: 'place', props: { exclusive: true }, title: 'main' },
    { op: 'create', ref: 'join', type: 'task', title: 'Integrate the lanes' },
  ]);
  const ctx = ownContext(l, 'sessions');
  const { run: laneRun } = await sessionsPack.sessionStart(ctx, agent as sessionsPack.Actor, { session_id: 's-lane', task: made.lane });
  const { run: leadRun } = await sessionsPack.sessionStart(ctx, agent as sessionsPack.Actor, { session_id: 's-lead', task: made.join });

  const refused = await push(l, 's-lane', 'git push -u origin claude/lane-2');
  assert.deepEqual(refused, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: LANE.say } });
  const beats = (await sessionsPack.story(ctx, { run: laneRun })).beats as sessionsPack.Beat[];
  const beat = beats.find((b) => b.did === 'refused');
  assert.ok(beat, 'kept as a refused beat');
  assert.equal(beat!.by, 'lanes');
  assert.match(beat!.said, /^Refused git push to claude\/lane-2: A lane is handed back/);

  assert.deepEqual(await push(l, 's-lane', 'git status'), {}, 'a command that sends nothing out goes');
  assert.deepEqual(await push(l, 's-nobody', 'git push'), {}, 'a session not registered is not stopped');
  assert.deepEqual(await push(l, 's-lead', 'git push origin claude/integrate'), {}, 'a push to a branch goes');

  const toMain = await push(l, 's-lead', 'gh pr merge 12 --merge');
  assert.equal(toMain.hookSpecificOutput.permissionDecisionReason, MAIN.say, 'main, not held, is refused');
  await callTool(l, agent, 'claim', { resource: made.main, holder: leadRun, reason: 'Merging the lanes' });
  assert.deepEqual(await push(l, 's-lead', 'gh pr merge 12 --merge'), {}, 'holding main, the merge goes');
  assert.deepEqual(await push(l, 's-lead', 'git push origin HEAD:main', 'claude/integrate'), {});
  await callTool(l, agent, 'release', { resource: made.main, holder: leadRun, reason: 'Deploy is up' });
  assert.ok((await push(l, 's-lead', 'git push origin main', 'main')).hookSpecificOutput, 'given back, the next push to main waits for a claim');
});
