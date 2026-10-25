import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serve } from './serve.ts';

test('an agent can point the human\'s screen, and its changes point it too', async () => {
  const { call } = await serve('off');
  assert.match((await call('/agent/show', undefined, {})).error, /needs "entity", "screen" or "lens"/);

  // A picture of the map: the lens and the style go in the address, and a lens that could not be drawn is refused here.
  await call('/agent/show', undefined, { actor: 'robot', lens: { far: 1, over: ['depends_on'] }, style: { lit: 'blocked' } });
  assert.equal((await call('/api/tail')).result.focus.hash, 'graph?far=1&over=depends_on&lit=blocked');
  await call('/agent/show', undefined, { actor: 'robot', lens: {} });
  assert.equal((await call('/api/tail')).result.focus.hash, 'graph?lens', 'the whole map as it opens');
  assert.match((await call('/agent/show', undefined, { lens: { by: 'nope' } })).error, /unknown kind of link/);
  assert.match((await call('/agent/show', undefined, { lens: { from: 'e_nothing0' } })).error, /No item/);

  await call('/agent/show', undefined, { actor: 'robot', screen: 'roadmap', of: 'e_x', note: 'Look here' });
  const shown = (await call('/api/tail')).result.focus;
  assert.deepEqual([shown.hash, shown.actor, shown.note], ['roadmap/e_x', 'robot', 'Look here']);

  await call('/agent/change', undefined, { actor: 'robot', reason: 'A note', ops: [{ op: 'create', type: 'work.note', title: 'N' }] });
  const proposed = (await call('/api/tail')).result.focus;
  assert.deepEqual([proposed.hash, proposed.note], ['review', 'A note'], 'a change that waits for review points at Review');
  assert.ok(proposed.at >= shown.at);

  await call('/api/change', undefined, { reason: 'mine', ops: [{ op: 'create', type: 'work.note', title: 'M' }] });
  assert.equal((await call('/api/tail')).result.focus.hash, 'review', 'the human\'s own changes do not move their screen');

  // Every step an agent takes is kept, the last few of them, each with its kind: the page follows the kinds the person chose.
  const last = async () => (await call('/api/tail')).result.steps.at(-1);
  const sofar = (await call('/api/tail')).result.steps.slice(-4);
  assert.deepEqual(sofar.map((s: any) => s.kind), ['show', 'show', 'show', 'change'], 'a show and an agent\'s change are steps; a refused call and the human\'s change are not');
  assert.deepEqual([sofar[2].did, sofar[2].hash, sofar[3].did], ['Look here', 'roadmap/e_x', 'A note']);
  await call('/agent/search', undefined, { actor: 'robot', q: 'N' });
  const searched = await last();
  assert.deepEqual([searched.kind, searched.actor, searched.did, searched.hash], ['search', 'robot', 'searched for "N"', undefined]);
  const note = (await call('/api/search', undefined, { q: 'M' })).result[0].id;
  assert.equal((await last()).at, searched.at, 'what the human reads is no step');
  await call('/agent/get', undefined, { actor: 'robot', id: note });
  const read = await last();
  assert.deepEqual([read.kind, read.did, read.hash], ['read', 'is reading this', `e/${note}`]);
  assert.ok(read.at > searched.at);
  await call('/agent/view', undefined, { actor: 'robot', name: 'lens' });
  assert.deepEqual([(await last()).kind, (await last()).did, (await last()).hash], ['view', 'asked for lens', 'graph?lens']);
  await call('/agent/proposals', undefined, { actor: 'robot' });
  assert.deepEqual([(await last()).kind, (await last()).did], ['read', 'proposals']);
  for (let i = 0; i < 12; i++) await call('/agent/search', undefined, { actor: 'robot', q: 'N' });
  const kept = (await call('/api/tail')).result.steps;
  assert.equal(kept.length, 12, 'only the last few are kept');
  assert.ok(kept.every((s: any, i: number) => !i || s.at > kept[i - 1].at));
  assert.equal((await call('/api/tail')).result.focus.hash, 'review', 'a step leaves where the agent pointed as it was');
});

test('an agent hears what the human does: by waiting for it, and with the owner\'s next message', async () => {
  const { call } = await serve('off');
  const made = await call('/api/change', undefined, { reason: 'seed', ops: [{ op: 'create', type: 'work.decision', title: 'Which?' }] });
  const id = made.result.created['#1'];
  const { latest } = (await call('/agent/watch')).result;
  assert.deepEqual((await call('/agent/watch', undefined, { after: latest })).result.changes, [], 'nothing yet, and no waiting when none is asked for');
  await call('/hooks/session-start', undefined, { session_id: 's1', cwd: '/nowhere' });
  assert.deepEqual(await call('/hooks/prompt', undefined, { session_id: 's1' }), { status: 200 }, 'nothing to tell');

  const waiting = call('/agent/watch', undefined, { after: latest, wait_seconds: 20 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await call('/api/tail')).result.listening, 1, 'the UI can see someone is listening');
  await call('/agent/change', undefined, { actor: 'robot', reason: 'noise', ops: [{ op: 'create', type: 'work.note', title: 'An agent\'s own change' }] });
  await call('/api/change', undefined, { reason: 'Decided in the UI', ops: [{ op: 'update', id, status: 'decided', props: { outcome: 'This one' } }] });
  const heard = (await waiting).result;
  assert.deepEqual([heard.changes.length, heard.changes[0].target.title, heard.changes[0].changes['props.outcome'].to], [1, 'Which?', 'This one'], 'woken by the human\'s change, not the agent\'s');
  assert.equal((await call('/api/tail')).result.listening, 0);

  const told = await call('/hooks/prompt', undefined, { session_id: 's1' });
  assert.match(told.hookSpecificOutput.additionalContext, /entity\.update work\.decision "Which\?".*props\.outcome: nothing -> "This one"/s);
  assert.deepEqual(await call('/hooks/prompt', undefined, { session_id: 's1' }), { status: 200 }, 'told once');

  // A session that began before this server did has lived through a restart: it is told, once, that its tools may be old.
  const { workspaces: ws, call: later } = await serve('off');
  const old = (await later('/agent/session_start', undefined, { session_id: 'before', title: 'Began before the deploy' })).result.run;
  await (await ws.get('default')).pelago.db.query(`update entity set created_at = now() - interval '1 hour' where id = $1`, [old]);
  const restarted = await later('/hooks/prompt', undefined, { session_id: 'before' });
  assert.match(restarted.hookSpecificOutput.additionalContext, /server has restarted since this session began .*now running commit [0-9a-f]{7}\).*POST \/agent\/<tool>/s);
  assert.deepEqual(await later('/hooks/prompt', undefined, { session_id: 'before' }), { status: 200 }, 'told once');
  await later('/hooks/session-start', undefined, { session_id: 'after', cwd: '/nowhere' });
  assert.deepEqual(await later('/hooks/prompt', undefined, { session_id: 'after' }), { status: 200 }, 'a session that began on this server is not told');
});

test('a server that asks for no token does not send the setup to look for one', async () => {
  const { base } = await serve('off');
  const project = mkdtempSync(join(tmpdir(), 'pelago-local-'));
  const out = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--yes'], { cwd: project, env: { ...process.env, PELAGO_AGENT_TOKEN: '' } });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', () => done(text));
  });
  assert.match(out, /Connected to http:\/\/127\.0\.0\.1:\d+, which asks for no token\./);
  assert.doesNotMatch(out, /no token yet/);
});

test('a project with nothing of Archipelago\'s in it is connected by one command, which adds to what is there and can be run again', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'pelago-customer-'));
  writeFileSync(join(project, 'CLAUDE.md'), '# Their project\n\nTheir own rules.\n');
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node scripts/pelago-hook.mjs prompt' }] }] } }));
  // The command the Workspace screen gives: no token is asked for, since the script holds no secret.
  const run = () =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--yes'], { cwd: project, env: { ...process.env, PELAGO_AGENT_TOKEN: '' } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
    });
  const first = await run();
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /written {4}\.mcp\.json[\s\S]*added to {3}CLAUDE\.md[\s\S]*this machine has no token yet/);
  const file = (path: string) => readFileSync(join(project, path), 'utf8');
  assert.equal(JSON.parse(file('.mcp.json')).mcpServers.pelago.url, `\${PELAGO_URL:-${base}}/mcp`);
  // What was theirs is kept; the three hooks are added beside it, and call the script that was written.
  const settings = JSON.parse(file('.claude/settings.json'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.deepEqual(settings.hooks.SessionEnd.map((h: any) => h.hooks[0].command), ['echo bye', 'node .claude/pelago-hook.mjs session-end']);
  assert.deepEqual(settings.hooks.UserPromptSubmit.map((h: any) => h.hooks[0].command), ['node .claude/pelago-hook.mjs prompt'], 'a hook registered at another place is pointed at the one the setup wrote');
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'node .claude/pelago-hook.mjs session-start');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'node .claude/pelago-hook.mjs stop', 'the end of a turn is heard too');
  assert.ok(file('.claude/pelago-hook.mjs').includes(`process.env.PELAGO_URL || process.env.LATTICE_URL || "${base}"`), 'the hook falls back on the server that handed it out');
  assert.match(file('.claude/skills/pelago-bump/SKILL.md'), /^---\nname: pelago-bump/);
  assert.match(file('.claude/pelago.md'), /query` with name `handoff`/);
  assert.match(file('CLAUDE.md'), /^# Their project\n\nTheir own rules\.\n\n## Archipelago\n[\s\S]*@\.claude\/pelago\.md\n$/);
  // Run again, it changes nothing.
  const before = [file('CLAUDE.md'), file('.claude/settings.json')];
  const again = await run();
  assert.doesNotMatch(again.out, /written|added to/);
  assert.deepEqual([file('CLAUDE.md'), file('.claude/settings.json')], before);
  // The first time on a machine the command carries the token in and asks for it to be kept: it is, with the
  // address, where the shell finds them, an older token replaced and nothing else there disturbed. It is not printed.
  const profile = join(project, 'profile');
  writeFileSync(profile, 'export PATH="$PATH:/opt/bin"\nexport PELAGO_AGENT_TOKEN="lat_default_old"\n');
  const kept = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--yes'], { cwd: project, env: { ...process.env, PELAGO_AGENT_TOKEN: 'lat_default_new', PELAGO_SETUP_SAVE: '1', PELAGO_SETUP_PROFILE: profile } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => done(out));
  });
  assert.match(kept, /kept {7}the server\u2019s address and the token, for this machine[\s\S]*Connected to/);
  assert.ok(!kept.includes('lat_default_new'));
  assert.equal(file('profile'), `export PATH="$PATH:/opt/bin"\nexport PELAGO_URL="${base}"\nexport PELAGO_AGENT_TOKEN="lat_default_new"\n`);

  // And the hook it wrote reaches the server from that folder.
  const hooked = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['.claude/pelago-hook.mjs', 'session-start'], { cwd: project, env: { ...process.env, PELAGO_URL: '', PELAGO_AGENT_TOKEN: '' } });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => done(err));
    child.stdin.end(JSON.stringify({ session_id: 'c1', cwd: project }));
  });
  assert.match(hooked, new RegExp(`${base.replace(/[.:/]/g, '\\$&')} answered 401`), 'it called this server, which wants the token the machine does not have yet');
});

test('a project connected while this was called Lattice is moved over by the setup, with nobody to ask', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'pelago-before-'));
  const at = (path: string) => join(project, path);
  const file = (path: string) => readFileSync(at(path), 'utf8');
  // As a setup left it then: the tools, the hook and its four entries, the rules, the skill, and one section.
  const old = {
    '.mcp.json': JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://example.test/mcp' }, lattice: { type: 'http', url: `\${LATTICE_URL:-${base}}/mcp`, headers: { Authorization: 'Bearer ${LATTICE_AGENT_TOKEN:-none}' } } } }),
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume|clear', hooks: [{ type: 'command', command: 'node .claude/lattice-hook.mjs session-start' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node .claude/lattice-hook.mjs prompt' }] }], Stop: [{ hooks: [{ type: 'command', command: 'node .claude/lattice-hook.mjs stop' }] }], SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }, { hooks: [{ type: 'command', command: 'node .claude/lattice-hook.mjs session-end' }] }] } }),
    '.claude/lattice-hook.mjs': '// the hook as it was\n',
    '.claude/lattice.md': '# Working with Lattice in this project\n',
    '.claude/skills/lattice-bump/SKILL.md': '---\nname: lattice-bump\n---\n',
    '.claude/skills/lattice-bump/references/home.md': 'where the map is\n',
    'CLAUDE.md': `# Their project\n\nTheir own rules.\n\n## Lattice\n\nThis project's work is kept in Lattice (${base}). How to work with it:\n\n@.claude/lattice.md\n`,
    'CLAUDE.local.md': 'Mine alone.\n\n@.claude/lattice.md\n',
    profile: 'export PATH="$PATH:/opt/bin"\nexport LATTICE_URL="https://old.example.test"\nexport LATTICE_AGENT_TOKEN="lat_default_kept"\n',
  };
  mkdirSync(at('.claude/skills/lattice-bump/references'), { recursive: true });
  for (const [path, text] of Object.entries(old)) writeFileSync(at(path), text);
  const setup = (flags: string[], env: Record<string, string>) =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, ...(flags.length ? ['--', ...flags] : [])], { cwd: project, env: { ...process.env, PELAGO_SETUP_PROFILE: at('profile'), ...env } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
    });

  // The machine still has its token under the old name, as a session opened before the move does.
  const moved = await setup([], { LATTICE_URL: 'https://old.example.test', LATTICE_AGENT_TOKEN: 'lat_default_kept' });
  assert.equal(moved.code, 0, moved.out);
  assert.ok(!moved.out.includes('lat_default_kept'));
  assert.doesNotMatch(moved.out, /not done|needs a yes/, 'all of it was the setup’s own');
  assert.match(moved.out, /run this once more/);
  for (const path of ['.claude/lattice-hook.mjs', '.claude/lattice.md', '.claude/skills/lattice-bump']) assert.ok(!existsSync(at(path)), `${path} is gone`);
  assert.match(file('.claude/skills/pelago-bump/SKILL.md'), /^---\nname: pelago-bump/);
  const mcp = JSON.parse(file('.mcp.json')).mcpServers;
  assert.deepEqual(Object.keys(mcp).sort(), ['other', 'pelago']);
  assert.equal(mcp.pelago.headers.Authorization, 'Bearer ${LATTICE_AGENT_TOKEN:-none}', 'until Claude Code is opened again it has the token under the old name only');
  const hooks = JSON.parse(file('.claude/settings.json')).hooks;
  assert.deepEqual(hooks.SessionEnd.map((h: any) => h.hooks[0].command), ['echo bye', 'node .claude/pelago-hook.mjs session-end']);
  assert.deepEqual([hooks.SessionStart, hooks.UserPromptSubmit, hooks.Stop].map((list) => list.map((h: any) => h.hooks[0].command)), [['node .claude/pelago-hook.mjs session-start'], ['node .claude/pelago-hook.mjs prompt'], ['node .claude/pelago-hook.mjs stop']]);
  assert.match(file('CLAUDE.md'), /^# Their project\n\nTheir own rules\.\n\n## Archipelago\n\nThis project's work is kept in Archipelago [\s\S]*@\.claude\/pelago\.md\n$/);
  assert.equal(file('CLAUDE.local.md'), 'Mine alone.\n\n@.claude/pelago.md\n');
  assert.equal(file('profile'), `${old.profile}export PELAGO_URL="https://old.example.test"\nexport PELAGO_AGENT_TOKEN="lat_default_kept"\n`);

  // Opened again, the machine has the token under the new name, and the tools read that.
  const settled = await setup([], { PELAGO_AGENT_TOKEN: 'lat_default_kept', LATTICE_AGENT_TOKEN: 'lat_default_kept' });
  assert.equal(settled.code, 0, settled.out);
  assert.equal(JSON.parse(file('.mcp.json')).mcpServers.pelago.headers.Authorization, 'Bearer ${PELAGO_AGENT_TOKEN:-none}');
  assert.doesNotMatch((await setup([], { PELAGO_AGENT_TOKEN: 'lat_default_kept' })).out, /written|changed|deleted/);

  // Taken out, neither name is left on the machine.
  const out = await setup(['--remove', '--machine', '--yes'], {});
  assert.equal(out.code, 0, out.out);
  assert.equal(file('profile'), 'export PATH="$PATH:/opt/bin"\n');
  assert.deepEqual(Object.keys(JSON.parse(file('.mcp.json')).mcpServers), ['other']);
});

test('a project whose settings file is not JSON is left as it was: the setup writes nothing at all', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'pelago-broken-'));
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), '{ "hooks": ');
  const { out, code } = await new Promise<{ out: string; code: number | null }>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`], { cwd: project, env: { ...process.env, PELAGO_AGENT_TOKEN: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ out, code }));
  });
  assert.equal(code, 1, out);
  assert.match(out, /settings\.json is there but is not JSON[\s\S]*Nothing was written/);
  // .mcp.json and the hook come before the settings file in the setup: neither is there.
  assert.deepEqual([existsSync(join(project, '.mcp.json')), existsSync(join(project, '.claude', 'pelago-hook.mjs')), existsSync(join(project, 'CLAUDE.md'))], [false, false, false]);
  assert.equal(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'), '{ "hooks": ');
});

