// Connect the project in this folder to a Lattice server, or take Lattice out of it again. The server hands
// this script out at GET /connect/setup.mjs with two lines in front of it: ORIGIN (its own address) and FILES
// (what to write). It is run once in each project, from that project's folder (the first time on a machine with
// the token carried in, which it then keeps for the machine), and can be run again: it writes only what is
// missing or has changed, and adds to .mcp.json, .claude/settings.json and CLAUDE.md without taking anything
// out of them. It holds no secret: the token is in the machine's environment (LATTICE_AGENT_TOKEN).
//
//   .mcp.json                         the lattice tools, for Claude Code
//   .claude/lattice-hook.mjs          tells Lattice a session started, was prompted, ended
//   .claude/settings.json             the four hooks that run it
//   .claude/skills/lattice-bump/      how to record friction with Lattice
//   .claude/lattice.md                how to work with the map, read through CLAUDE.md
//   .claude/lattice-setup.json        what the setup wrote, so it can be taken out again
//
// It shows what it will change and asks before it writes. Options go after "--" at the end of the command:
//
//   --dry-run   show what would change and write nothing
//   --yes       write without asking
//   --remove    take out what the setup wrote, and nothing else
//   --machine   with --remove: also forget the address and token kept for this machine
//
// With nobody to ask (no terminal) and no --yes, it brings up to date only what Lattice wrote here before, and
// refuses to set a project up for the first time.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const OPTIONS = ['--dry-run', '--yes', '--remove', '--machine'];
const given = process.argv.slice(1).filter((arg) => arg.startsWith('--'));
const unknown = given.filter((arg) => !OPTIONS.includes(arg));
if (unknown.length) {
  console.error(`Not an option of the setup: ${unknown.join(', ')}. It takes ${OPTIONS.join(', ')}. Nothing was written.`);
  process.exit(1);
}
const [DRY, YES, REMOVE, MACHINE] = OPTIONS.map((option) => given.includes(option));
const AGAIN = 'run the same command with  -- --yes  at its end';

const here = process.cwd();
const abs = (path) => join(here, path);
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const COPY = '.lattice-backup';
const MANIFEST = '.claude/lattice-setup.json';
const HOOK = '.claude/lattice-hook.mjs';
// The files that are Lattice's own, whole: written by the setup and replaced by it when the server's change.
const OWN = { [HOOK]: FILES.hook, '.claude/skills/lattice-bump/SKILL.md': FILES.skill, '.claude/skills/lattice-bump/references/home.md': FILES.home, '.claude/lattice.md': FILES.rules };
const SECTION = /(^|\n+)## Lattice\n\nThis project's work is kept in Lattice \([^)\n]*\)\. How to work with it:\n\n@\.claude\/lattice\.md\n*$/;

// Every change is worked out first and made only once all of them are known: a file that cannot be read stops
// the run with nothing written. A step is one change: what will be done (will), what is said once it is (say),
// how to do it (make, or null when there is nothing to do), and whether it only renews what Lattice already
// wrote here (own), which is all a run with nobody to ask may do.
const plan = [];
const did = [];

function parsed(path) {
  const was = read(abs(path));
  if (was === null) return {};
  try {
    return JSON.parse(was);
  } catch {
    console.error(`${path} is there but is not JSON. Fix or remove it, then run this again. Nothing was written.`);
    process.exit(1);
  }
}

/** A file is to hold this text. One that was there and is not Lattice's own is copied beside itself first, once. */
function put(path, text, { own = false, verb = 'written  ', note = '' } = {}) {
  const file = abs(path);
  const was = read(file);
  if (was === text) return plan.push({ say: `as it was  ${path}`, make: null });
  const copy = !own && was !== null && !existsSync(file + COPY);
  plan.push({
    will: `${was === null ? 'write    ' : verb === 'added to ' ? 'add to   ' : 'change   '}  ${path}${note && `  ${note}`}${copy ? `  (a copy is kept: ${path}${COPY})` : ''}`,
    say: `${verb}  ${path}`,
    path,
    own,
    make: () => {
      mkdirSync(dirname(file), { recursive: true });
      if (copy) writeFileSync(file + COPY, was);
      writeFileSync(file, text);
    },
  });
}

/** A file is to go: all of it, or back to the text it would hold without Lattice. */
function take(path, text, note = '') {
  const file = abs(path);
  if (text === null) plan.push({ will: `delete     ${path}${note && `  ${note}`}`, say: `deleted    ${path}`, path, make: () => rmSync(file) });
  else plan.push({ will: `change     ${path}${note && `  ${note}`}`, say: `changed    ${path}`, path, make: () => writeFileSync(file, text) });
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const hasServer = (config) => Boolean(config.mcpServers?.lattice);
const hasHooks = (config) => JSON.stringify(config.hooks ?? {}).includes('lattice-hook.mjs');

// Where the address and the token are kept for this person on this machine: on Windows the user's
// environment; elsewhere the shell's start-up file, and on a Mac also what apps opened from the Dock are given.
const profile = process.env.LATTICE_SETUP_PROFILE;
const inEnvironment = process.platform === 'win32' && !profile;
const startup = profile || join(homedir(), process.platform === 'darwin' || (process.env.SHELL ?? '').endsWith('zsh') ? '.zshenv' : '.profile');
const kept = /^export LATTICE_(URL|AGENT_TOKEN)=/;
const NAMES = ['LATTICE_URL', 'LATTICE_AGENT_TOKEN'];
const MACHINE_STEP = 'the address and token for this machine';
const notKept = (err) => console.error(`The address and token could not be kept for this machine (${err.message}). Set LATTICE_URL and LATTICE_AGENT_TOKEN yourself, then run this again.`);

function connect() {
  const mcp = parsed('.mcp.json');
  const mcpOwn = hasServer(mcp);
  mcp.mcpServers ??= {};
  mcp.mcpServers.lattice = { type: 'http', url: `\${LATTICE_URL:-${ORIGIN}}/mcp`, headers: { Authorization: 'Bearer ${LATTICE_AGENT_TOKEN:-none}' } };
  put('.mcp.json', json(mcp), { own: mcpOwn, note: mcpOwn ? '' : '(adds the lattice tools)' });

  put(HOOK, FILES.hook, { own: true });

  const settings = parsed('.claude/settings.json');
  const settingsOwn = hasHooks(settings);
  settings.hooks ??= {};
  for (const [event, name, matcher] of [['SessionStart', 'session-start', 'startup|resume|clear'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end']]) {
    const list = (settings.hooks[event] ??= []);
    const command = `node ${HOOK} ${name}`;
    // A hook registered at another place (an older setup, or Lattice's own repository running the script it
    // hands out) is pointed at the one written here: the other does not say which hand-out it is.
    for (const entry of list) for (const hook of entry.hooks ?? []) if (typeof hook.command === 'string' && hook.command.includes('lattice-hook.mjs')) hook.command = command;
    if (JSON.stringify(list).includes('lattice-hook.mjs')) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command }] });
  }
  put('.claude/settings.json', json(settings), { own: settingsOwn, note: settingsOwn ? '' : '(adds four hooks that run the script above)' });

  for (const [path, text] of Object.entries(OWN)) if (path !== HOOK) put(path, text, { own: true });
  put(MANIFEST, json({ files: Object.fromEntries(Object.entries(OWN).map(([path, text]) => [path, sha(text)])) }), { own: true });

  // The first time on a machine, the command that runs this carries the token in and asks for it to be kept
  // (LATTICE_SETUP_SAVE): Claude Code and the hook find it there from then on. The token is never printed.
  if (process.env.LATTICE_SETUP_SAVE && process.env.LATTICE_AGENT_TOKEN) {
    const keep = { LATTICE_URL: ORIGIN, LATTICE_AGENT_TOKEN: process.env.LATTICE_AGENT_TOKEN };
    const say = 'kept       the server’s address and the token, for this machine';
    if (inEnvironment) {
      plan.push({
        will: `keep       ${NAMES.join(' and ')} in your Windows user environment, outside this folder`,
        say,
        path: MACHINE_STEP,
        machine: true,
        make: () => {
          for (const [name, value] of Object.entries(keep)) execFileSync('setx', [name, value], { stdio: 'ignore' });
        },
      });
    } else {
      try {
        const was = read(startup);
        const lines = (was ?? '').split('\n');
        // A value kept before (an older token) is replaced, not left beside the new one.
        const rest = lines.filter((line) => !kept.test(line));
        while (rest.length && rest.at(-1) === '') rest.pop();
        // The copy is of the file before Lattice first added to it: once its lines are there, no copy is made.
        const copy = was !== null && !lines.some((line) => kept.test(line)) && !existsSync(startup + COPY);
        plan.push({
          will: `keep       ${NAMES.join(' and ')} in ${startup}, outside this folder${copy ? `  (a copy is kept: ${startup}${COPY})` : ''}`,
          say,
          path: MACHINE_STEP,
          machine: true,
          make: () => {
            if (copy) writeFileSync(startup + COPY, was, { mode: 0o600 });
            writeFileSync(startup, [...rest, ...Object.entries(keep).map(([name, value]) => `export ${name}="${value}"`), ''].join('\n'), { mode: 0o600 });
            if (process.platform === 'darwin' && !profile) for (const [name, value] of Object.entries(keep)) try { execFileSync('launchctl', ['setenv', name, value], { stdio: 'ignore' }); } catch { /* only apps opened from the Dock miss it */ }
          },
        });
      } catch (err) {
        notKept(err);
      }
    }
  }

  // CLAUDE.md is the project's own: one section is added to it, once, that reads the rules in. A project that
  // keeps its own setup out of git reads the rules in from CLAUDE.local.md instead.
  const had = read(abs('CLAUDE.md')) ?? '';
  const reads = (text) => (text ?? '').includes('@.claude/lattice.md');
  if (reads(had) || reads(read(abs('CLAUDE.local.md')))) plan.push({ say: 'as it was  CLAUDE.md', make: null });
  else put('CLAUDE.md', `${had ? had.trimEnd() + '\n\n' : ''}## Lattice\n\nThis project's work is kept in Lattice (${ORIGIN}). How to work with it:\n\n@.claude/lattice.md\n`, { verb: had ? 'added to ' : 'written  ', note: '(one section, which reads .claude/lattice.md in)' });
}

function remove() {
  const mcp = parsed('.mcp.json');
  if (hasServer(mcp)) {
    delete mcp.mcpServers.lattice;
    if (!Object.keys(mcp.mcpServers).length) delete mcp.mcpServers;
    const empty = !Object.keys(mcp).length;
    take('.mcp.json', empty ? null : json(mcp), empty ? '(it holds nothing else)' : '(takes the lattice tools out)');
  }

  const settings = parsed('.claude/settings.json');
  if (hasHooks(settings)) {
    const ours = (hook) => typeof hook.command === 'string' && hook.command.includes('lattice-hook.mjs');
    for (const [event, list] of Object.entries(settings.hooks)) {
      if (!Array.isArray(list)) continue;
      // An entry that held only Lattice's hook goes; one that holds another's as well keeps that.
      settings.hooks[event] = list.filter((entry) => {
        if (!(entry.hooks ?? []).some(ours)) return true;
        entry.hooks = entry.hooks.filter((hook) => !ours(hook));
        return entry.hooks.length > 0;
      });
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    const empty = !Object.keys(settings).length;
    take('.claude/settings.json', empty ? null : json(settings), empty ? '(it holds nothing else)' : '(takes the four hooks out)');
  }

  // What the setup wrote is known by the list it left. Without one (a project set up before there was a list),
  // a file is taken to be as written when it is what the server hands out today. One changed since is kept.
  let wrote = null;
  try {
    wrote = JSON.parse(read(abs(MANIFEST)) ?? 'null')?.files ?? null;
  } catch { /* an unreadable list is no list */ }
  for (const [path, text] of Object.entries(OWN)) {
    const was = read(abs(path));
    if (was === null) continue;
    // The hook is run, never written by hand: it goes whatever it holds.
    if (path === HOOK || sha(was) === (wrote?.[path] ?? sha(text))) take(path, null);
    else plan.push({ say: `kept       ${path}  (changed since the setup wrote it)`, make: null });
  }
  if (existsSync(abs(MANIFEST))) take(MANIFEST, null);

  for (const path of ['CLAUDE.md', 'CLAUDE.local.md']) {
    const had = read(abs(path));
    if (had === null || !had.includes('@.claude/lattice.md')) continue;
    const match = path === 'CLAUDE.md' && had.match(SECTION);
    if (!match) plan.push({ say: `kept       ${path}  (it reads .claude/lattice.md in, in words that are not the setup’s: take that out yourself)`, make: null });
    else if (match.index === 0) take(path, null, '(it holds nothing else)');
    else take(path, had.slice(0, match.index).trimEnd() + '\n', '(takes the Lattice section out)');
  }

  if (!MACHINE) return;
  const say = 'forgot     the server’s address and the token, on this machine';
  if (inEnvironment) {
    const there = NAMES.filter((name) => {
      try {
        execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });
    if (there.length)
      plan.push({
        will: `forget     ${there.join(' and ')} in your Windows user environment, outside this folder`,
        say,
        path: MACHINE_STEP,
        make: () => {
          for (const name of there) execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', name, '/f'], { stdio: 'ignore' });
        },
      });
  } else {
    const was = read(startup);
    const lines = (was ?? '').split('\n');
    if (lines.some((line) => kept.test(line)))
      plan.push({
        will: `forget     ${NAMES.join(' and ')} in ${startup}, outside this folder`,
        say,
        path: MACHINE_STEP,
        make: () => {
          writeFileSync(startup, lines.filter((line) => !kept.test(line)).join('\n'), { mode: 0o600 });
          if (process.platform === 'darwin' && !profile) for (const name of NAMES) try { execFileSync('launchctl', ['unsetenv', name], { stdio: 'ignore' }); } catch { /* it was not set there */ }
        },
      });
  }
}

// What was here before this run says whether it is a first setup: the hook is the one file every setup wrote.
const before = existsSync(abs(HOOK));
if (REMOVE) remove();
else connect();

const todo = plan.filter((step) => step.make);
let go = todo;
if (todo.length) {
  const show = (lead) => console.log(`${lead}\n\n${todo.map((step) => step.will).join('\n')}`);
  if (DRY) {
    show(`In ${here}, this would:`);
    console.log('\nNothing was written (--dry-run).');
    process.exit(0);
  } else if (YES) {
    // Said beforehand.
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    show(`In ${here}, this will:`);
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await ask.question('\nGo ahead? [y/N] ')).trim().toLowerCase();
    ask.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Nothing was written.');
      process.exit(0);
    }
    console.log('');
  } else if (REMOVE || !before) {
    show(`In ${here}, this would:`);
    console.error(`\nNothing was written: ${REMOVE ? 'taking Lattice out' : 'this folder has nothing of Lattice’s yet, and setting it up for the first time'} needs a yes, and nobody is here to give one. Read the above, then ${AGAIN}.`);
    process.exit(1);
  } else {
    // Nobody to ask, in a project set up before: what Lattice wrote is brought up to date, the rest is left and said.
    go = todo.filter((step) => step.own);
  }
} else if (DRY) {
  console.log(REMOVE ? 'Nothing of the setup’s is in this folder.' : `${plan.map((step) => step.say).join('\n')}\n\nNothing would change.`);
  process.exit(0);
}

// Only now is anything written. Keeping the token is the one step that may fail and leave the rest standing.
for (const step of plan) {
  if (step.make && !go.includes(step)) {
    did.push(`not done   ${step.path}  (it needs a yes)`);
    continue;
  }
  try {
    step.make?.();
    did.push(step.say);
  } catch (err) {
    if (!step.machine) throw err;
    notKept(err);
  }
}

if (REMOVE) {
  // A folder the setup made and has now emptied goes too; one that holds anything else stays.
  for (const path of ['.claude/skills/lattice-bump/references', '.claude/skills/lattice-bump', '.claude/skills', '.claude']) try { rmdirSync(abs(path)); } catch { /* not empty, or not there */ }
  console.log(did.length ? did.join('\n') : 'Nothing of the setup’s is in this folder.');
  const copies = ['.mcp.json', '.claude/settings.json', 'CLAUDE.md'].filter((path) => existsSync(abs(path) + COPY)).map((path) => path + COPY);
  if (todo.length) console.log(`\nLattice is out of ${here}. The map on the server was not touched.${copies.length ? ` The copies the setup kept are still here: ${copies.join(', ')}.` : ''}`);
  if (!MACHINE) console.log(`\nThe address and token kept for this machine were left: add --machine to forget them, and revoke the token on the Workspace screen at ${ORIGIN} to end it.`);
  process.exit(0);
}

console.log(did.join('\n'));
if (go.length < todo.length) console.log(`\nSome of it was left, because nobody was here to say yes. To do the rest, ${AGAIN}.`);

// Claude Code runs a folder's hooks and finds its skills only in a session opened in that folder. Set up in a
// folder that holds several repositories, a session in one of them reads the rules and is given nothing else.
let top = '';
try {
  top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* not in a repository, or no git */ }
const same = (a, b) => a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
if (!top || !same(top, here))
  console.log(
    `\nMind: ${here} is not the top folder of a git repository${top ? ` (that is ${top})` : ''}. A session reports to Lattice only when Claude Code is opened in the folder this was run in: run it in each repository's own folder.`,
  );
console.log(
  process.env.LATTICE_AGENT_TOKEN
    ? `\nConnected to ${ORIGIN}. Quit Claude Code completely${process.platform === 'win32' ? ' (from the system tray too)' : ''}, open it again in this folder, and the session will say it is registered in Lattice.`
    : `\nThe files are in place, but this machine has no token yet. On the Workspace screen at ${ORIGIN}, press Connect an agent and run the command it gives under 1, in this folder.`,
);
