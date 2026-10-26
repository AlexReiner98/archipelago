// Connect the project in this folder to an Archipelago server, or take Archipelago out of it again. The server hands
// this script out at GET /connect/setup.mjs with two lines in front of it: ORIGIN (its own address) and FILES
// (what to write). It is run once in each project, from that project's folder (the first time on a machine with
// the token carried in, which it then keeps for the machine), and can be run again: it writes only what is
// missing or has changed, and adds to .mcp.json, .claude/settings.json and CLAUDE.md without taking anything
// out of them. It holds no secret: the token is in the machine's environment (PELAGO_AGENT_TOKEN).
//
//   .mcp.json                         the pelago tools, for Claude Code
//   .claude/pelago-hook.mjs          tells Archipelago a session started, was prompted, ended
//   .claude/settings.json             the four hooks that run it
//   .claude/skills/pelago-bump/      how to record friction with Archipelago
//   .claude/pelago.md                how to work with the map, read through CLAUDE.md
//   .claude/pelago-setup.json        what the setup wrote, so it can be taken out again
//   .worktreeinclude                 the ignored files above, which Claude Code then copies into each worktree it makes
//   .git/hooks/commit-msg            names, in a commit a session makes, the session's run (not where the project has
//                                    a commit-msg hook of its own, or its hooks are another tool's: core.hooksPath)
//
// It shows what it will change and asks before it writes. Options go after "--" at the end of the command:
//
//   --dry-run   show what would change and write nothing
//   --yes       write without asking
//   --remove    take out what the setup wrote, and nothing else
//   --machine   with --remove: also forget the address and token kept for this machine
//
// With nobody to ask (no terminal) and no --yes, it brings up to date only what Archipelago wrote here before, and
// refuses to set a project up for the first time.
//
// A project connected while this was called Lattice holds the same files under that name (lattice-hook.mjs,
// lattice.md, the lattice-bump skill, the lattice tools in .mcp.json). They are the setup's own: a run moves the
// project over to the names above, and --remove takes out either.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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
const COPY = '.pelago-backup';
const copied = (file) => existsSync(file + COPY) || existsSync(file + '.lattice-backup');
const MANIFEST = '.claude/pelago-setup.json';
const HOOK = '.claude/pelago-hook.mjs';
const RULES = '.claude/pelago.md';
// The files that are Archipelago's own, whole: written by the setup and replaced by it when the server's change.
const OWN = { [HOOK]: FILES.hook, '.claude/skills/pelago-bump/SKILL.md': FILES.skill, '.claude/skills/pelago-bump/references/home.md': FILES.home, [RULES]: FILES.rules };
const SECTION = /(^|\n+)## (Archipelago|Lattice)\n\nThis project's work is kept in \2 \([^)\n]*\)\. How to work with it:\n\n@\.claude\/(pelago|lattice)\.md\n*$/;
const section = `## Archipelago\n\nThis project's work is kept in Archipelago (${ORIGIN}). How to work with it:\n\n@${RULES}\n`;
// The same things as a setup wrote them while this was called Lattice.
const OLD = { hook: '.claude/lattice-hook.mjs', manifest: '.claude/lattice-setup.json', rules: '.claude/lattice.md', skill: ['.claude/skills/lattice-bump/SKILL.md', '.claude/skills/lattice-bump/references/home.md'] };
const ourHook = /(pelago|lattice)-hook\.mjs/;
// The git hook that names the run of the session making a commit. The hook script keeps each session's run in the
// checkout's git folder (pelago-runs/<session id>, shared by its worktrees); Claude Code gives every command a
// session runs its id (CLAUDE_CODE_SESSION_ID). A commit made by a person has no session, and one made by a session
// Archipelago does not know has no run kept: either is left as it is. It is plain sh and git, so it works in a
// worktree that has none of the project's ignored files, and never stops a commit.
const COMMIT_MARK = '# Archipelago: names the run';
const COMMIT_HOOK = `#!/bin/sh
${COMMIT_MARK} of the Claude Code session making this commit. Written by Archipelago's setup, which takes it out again.
id="$CLAUDE_CODE_SESSION_ID"
case "$id" in ''|*[!A-Za-z0-9_-]*) exit 0 ;; esac
run=$(cat "$(git rev-parse --git-common-dir)/pelago-runs/$id" 2>/dev/null) || exit 0
case "$run" in ''|*[!A-Za-z0-9_-]*) exit 0 ;; esac
git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Archipelago-Run: $run" "$1" || true
exit 0
`;
// Claude Code copies into a worktree it makes (the desktop app's, --worktree, a subagent's) only the ignored files
// .worktreeinclude names. Without them a session there has no hooks, so no run, and its commits name none.
const INCLUDE = '.worktreeinclude';
const INCLUDE_MARK = "# Archipelago's setup: what it wrote, for each worktree Claude Code makes";
const CARRIED = ['.mcp.json', '.claude/settings.json', HOOK, RULES, '.claude/skills/pelago-bump/references/home.md'];
/** A .worktreeinclude without the setup's lines in it. */
const withoutCarried = (text) => {
  const lines = text.split('\n');
  const at = lines.indexOf(INCLUDE_MARK);
  if (at < 0) return text.trim();
  let end = at + 1;
  while (end < lines.length && CARRIED.includes(lines[end])) end++;
  return [...lines.slice(0, at), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
const reads = (text) => /@\.claude\/(pelago|lattice)\.md/.test(text ?? '');

// Every change is worked out first and made only once all of them are known: a file that cannot be read stops
// the run with nothing written. A step is one change: what will be done (will), what is said once it is (say),
// how to do it (make, or null when there is nothing to do), and whether it only renews what Archipelago already
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

/** A file is to hold this text. One that was there and is not Archipelago's own is copied beside itself first, once. */
function put(path, text, { own = false, verb = 'written  ', note = '' } = {}) {
  const file = abs(path);
  const was = read(file);
  if (was === text) return plan.push({ say: `as it was  ${path}`, make: null });
  const copy = !own && was !== null && !copied(file);
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

/** A file is to go: all of it, or back to the text it would hold without Archipelago. */
function take(path, text, note = '', own = false) {
  const file = abs(path);
  if (text === null) plan.push({ will: `delete     ${path}${note && `  ${note}`}`, say: `deleted    ${path}`, path, own, make: () => rmSync(file) });
  else plan.push({ will: `change     ${path}${note && `  ${note}`}`, say: `changed    ${path}`, path, own, make: () => writeFileSync(file, text) });
}

/** Where git looks for this checkout's hooks and keeps its runs, relative to here; null outside a checkout, and other when another tool keeps its hooks (core.hooksPath). */
function gitFolder() {
  const git = (...args) => execFileSync('git', args, { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const at = (path) => relative(here, resolve(here, path)).replace(/\\/g, '/');
    const found = { hook: at(join(git('rev-parse', '--git-path', 'hooks'), 'commit-msg')), runs: at(join(git('rev-parse', '--git-common-dir'), 'pelago-runs')) };
    try {
      if (git('config', '--get', 'core.hooksPath')) return { ...found, other: true };
    } catch { /* not set */ }
    return found;
  } catch {
    return null;
  }
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const hasServer = (config) => Boolean(config.mcpServers?.pelago || config.mcpServers?.lattice);
const hasHooks = (config) => ourHook.test(JSON.stringify(config.hooks ?? {}));

// Where the address and the token are kept for this person on this machine: on Windows the user's
// environment; elsewhere the shell's start-up file, and on a Mac also what apps opened from the Dock are given.
const profile = process.env.PELAGO_SETUP_PROFILE;
const inEnvironment = process.platform === 'win32' && !profile;
const startup = profile || join(homedir(), process.platform === 'darwin' || (process.env.SHELL ?? '').endsWith('zsh') ? '.zshenv' : '.profile');
const kept = /^export PELAGO_(URL|AGENT_TOKEN)=/;
const keptEver = /^export (PELAGO|LATTICE)_(URL|AGENT_TOKEN)=/;
const NAMES = ['PELAGO_URL', 'PELAGO_AGENT_TOKEN'];
const OLD_NAMES = ['LATTICE_URL', 'LATTICE_AGENT_TOKEN'];
// A machine connected while this was called Lattice keeps its token under the old name. Claude Code is given a
// machine's environment when it is opened, not when it changes, so .mcp.json goes on reading the old names
// until a run finds the token under the new one; this run keeps it there as well.
const carried = !process.env.PELAGO_AGENT_TOKEN && Boolean(process.env.LATTICE_AGENT_TOKEN);
const [URL_NAME, TOKEN_NAME] = carried ? OLD_NAMES : NAMES;
const token = process.env[TOKEN_NAME];
const MACHINE_STEP = 'the address and token for this machine';
const notKept = (err) => console.error(`The address and token could not be kept for this machine (${err.message}). Set PELAGO_URL and PELAGO_AGENT_TOKEN yourself, then run this again.`);

function connect() {
  const mcp = parsed('.mcp.json');
  const mcpOwn = hasServer(mcp);
  mcp.mcpServers ??= {};
  delete mcp.mcpServers.lattice;
  mcp.mcpServers.pelago = { type: 'http', url: `\${${URL_NAME}:-${ORIGIN}}/mcp`, headers: { Authorization: `Bearer \${${TOKEN_NAME}:-none}` } };
  put('.mcp.json', json(mcp), { own: mcpOwn, note: mcpOwn ? '' : '(adds the pelago tools)' });

  put(HOOK, FILES.hook, { own: true });
  if (existsSync(abs(OLD.hook))) take(OLD.hook, null, '(it is now pelago-hook.mjs)', true);

  const settings = parsed('.claude/settings.json');
  const settingsOwn = hasHooks(settings);
  settings.hooks ??= {};
  for (const [event, name, matcher] of [['SessionStart', 'session-start', 'startup|resume|clear'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end']]) {
    const list = (settings.hooks[event] ??= []);
    const command = `node ${HOOK} ${name}`;
    // A hook registered at another place (an older setup, or Archipelago's own repository running the script it
    // hands out) is pointed at the one written here: the other does not say which hand-out it is.
    for (const entry of list) for (const hook of entry.hooks ?? []) if (typeof hook.command === 'string' && ourHook.test(hook.command)) hook.command = command;
    if (ourHook.test(JSON.stringify(list))) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command }] });
  }
  put('.claude/settings.json', json(settings), { own: settingsOwn, note: settingsOwn ? '' : '(adds four hooks that run the script above)' });

  for (const [path, text] of Object.entries(OWN)) if (path !== HOOK) put(path, text, { own: true });

  const git = gitFolder();
  const commit = git && read(abs(git.hook));
  if (git?.other) plan.push({ say: `left       the commit-msg hook  (this checkout's git hooks are another tool's, core.hooksPath: commits do not name their run)`, make: null });
  else if (commit === COMMIT_HOOK) plan.push({ say: `as it was  ${git.hook}`, make: null });
  else if (commit != null && !commit.includes(COMMIT_MARK)) plan.push({ say: `kept       ${git.hook}  (the project's own commit-msg hook: commits do not name their run)`, make: null });
  else if (git)
    plan.push({
      will: `${commit == null ? 'write    ' : 'change   '}  ${git.hook}  (names the session's run in a commit a session makes)`,
      say: `written    ${git.hook}`,
      path: git.hook,
      own: true,
      make: () => {
        mkdirSync(dirname(abs(git.hook)), { recursive: true });
        writeFileSync(abs(git.hook), COMMIT_HOOK);
        chmodSync(abs(git.hook), 0o755);
      },
    });
  const include = read(abs(INCLUDE));
  const rest = withoutCarried(include ?? '');
  const includeOwn = Boolean(include?.includes(INCLUDE_MARK));
  put(INCLUDE, `${rest ? `${rest}\n\n` : ''}${[INCLUDE_MARK, ...CARRIED].join('\n')}\n`, { own: includeOwn, verb: include ? 'added to ' : 'written  ', note: includeOwn ? '' : '(so a worktree Claude Code makes has the hooks)' });
  put(MANIFEST, json({ files: Object.fromEntries(Object.entries(OWN).map(([path, text]) => [path, sha(text)])) }), { own: true });
  for (const path of [...OLD.skill, OLD.rules, OLD.manifest]) if (existsSync(abs(path))) take(path, null, '(it has a new name, above)', true);

  // The first time on a machine, the command that runs this carries the token in and asks for it to be kept
  // (PELAGO_SETUP_SAVE): Claude Code and the hook find it there from then on. The token is never printed.
  if ((process.env.PELAGO_SETUP_SAVE && token) || carried) {
    const keep = { PELAGO_URL: carried ? process.env.LATTICE_URL || ORIGIN : ORIGIN, PELAGO_AGENT_TOKEN: token };
    const say = `kept       the server’s address and the token${carried ? ' under their new names' : ''}, for this machine`;
    if (inEnvironment) {
      plan.push({
        will: `keep       ${NAMES.join(' and ')} in your Windows user environment, outside this folder`,
        say,
        path: MACHINE_STEP,
        machine: true,
        own: carried,
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
        // The copy is of the file before Archipelago first added to it: once its lines are there, no copy is made.
        const copy = was !== null && !lines.some((line) => keptEver.test(line)) && !copied(startup);
        plan.push({
          will: `keep       ${NAMES.join(' and ')} in ${startup}, outside this folder${copy ? `  (a copy is kept: ${startup}${COPY})` : ''}`,
          say,
          path: MACHINE_STEP,
          machine: true,
          own: carried,
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
  const local = read(abs('CLAUDE.local.md'));
  // Where the rules are read in under their old name, the section the setup wrote is written again; in words
  // that are not the setup's, only the file's name is changed.
  const renamed = (text) => (SECTION.test(text) ? text.replace(SECTION, (all, lead) => lead + section) : text.replaceAll('@.claude/lattice.md', `@${RULES}`));
  if (!reads(had) && !reads(local)) put('CLAUDE.md', `${had ? had.trimEnd() + '\n\n' : ''}${section}`, { verb: had ? 'added to ' : 'written  ', note: `(one section, which reads ${RULES} in)` });
  else for (const [path, text] of [['CLAUDE.md', had], ['CLAUDE.local.md', local ?? '']]) if (reads(text)) put(path, renamed(text), { own: true, verb: 'changed  ' });
}

function remove() {
  const mcp = parsed('.mcp.json');
  if (hasServer(mcp)) {
    delete mcp.mcpServers.pelago;
    delete mcp.mcpServers.lattice;
    if (!Object.keys(mcp.mcpServers).length) delete mcp.mcpServers;
    const empty = !Object.keys(mcp).length;
    take('.mcp.json', empty ? null : json(mcp), empty ? '(it holds nothing else)' : '(takes the pelago tools out)');
  }

  const settings = parsed('.claude/settings.json');
  if (hasHooks(settings)) {
    const ours = (hook) => typeof hook.command === 'string' && ourHook.test(hook.command);
    for (const [event, list] of Object.entries(settings.hooks)) {
      if (!Array.isArray(list)) continue;
      // An entry that held only Archipelago's hook goes; one that holds another's as well keeps that.
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
  const include = read(abs(INCLUDE));
  if (include?.includes(INCLUDE_MARK)) {
    const rest = withoutCarried(include);
    take(INCLUDE, rest ? `${rest}\n` : null, rest ? "(takes the setup's lines out)" : '(it holds nothing else)', true);
  }
  // The commit-msg hook goes only when it is the setup's, and the runs kept for it with it.
  const git = gitFolder();
  if (git && read(abs(git.hook))?.includes(COMMIT_MARK)) take(git.hook, null);
  if (git && existsSync(abs(git.runs))) plan.push({ will: `delete     ${git.runs}/  (the runs kept for the commit-msg hook)`, say: `deleted    ${git.runs}/`, path: git.runs, make: () => rmSync(abs(git.runs), { recursive: true, force: true }) });
  // What a setup wrote under the old name left no list, or one of files nobody is handed any more: all of it goes.
  for (const path of [OLD.hook, ...OLD.skill, OLD.rules, OLD.manifest]) if (existsSync(abs(path))) take(path, null);

  for (const path of ['CLAUDE.md', 'CLAUDE.local.md']) {
    const had = read(abs(path));
    if (had === null || !reads(had)) continue;
    const match = path === 'CLAUDE.md' && had.match(SECTION);
    if (!match) plan.push({ say: `kept       ${path}  (it reads ${RULES} in, in words that are not the setup’s: take that out yourself)`, make: null });
    else if (match.index === 0) take(path, null, '(it holds nothing else)');
    else take(path, had.slice(0, match.index).trimEnd() + '\n', '(takes the Archipelago section out)');
  }

  if (!MACHINE) return;
  const say = 'forgot     the server’s address and the token, on this machine';
  if (inEnvironment) {
    const there = [...NAMES, ...OLD_NAMES].filter((name) => {
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
    if (lines.some((line) => keptEver.test(line)))
      plan.push({
        will: `forget     ${NAMES.join(' and ')} in ${startup}, outside this folder`,
        say,
        path: MACHINE_STEP,
        make: () => {
          writeFileSync(startup, lines.filter((line) => !keptEver.test(line)).join('\n'), { mode: 0o600 });
          if (process.platform === 'darwin' && !profile) for (const name of [...NAMES, ...OLD_NAMES]) try { execFileSync('launchctl', ['unsetenv', name], { stdio: 'ignore' }); } catch { /* it was not set there */ }
        },
      });
  }
}

// What was here before this run says whether it is a first setup: the hook is the one file every setup wrote.
const before = existsSync(abs(HOOK)) || existsSync(abs(OLD.hook));
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
    console.error(`\nNothing was written: ${REMOVE ? 'taking Archipelago out' : 'this folder has nothing of Archipelago’s yet, and setting it up for the first time'} needs a yes, and nobody is here to give one. Read the above, then ${AGAIN}.`);
    process.exit(1);
  } else {
    // Nobody to ask, in a project set up before: what Archipelago wrote is brought up to date, the rest is left and said.
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
  for (const path of ['.claude/skills/pelago-bump/references', '.claude/skills/pelago-bump', '.claude/skills/lattice-bump/references', '.claude/skills/lattice-bump', '.claude/skills', '.claude']) try { rmdirSync(abs(path)); } catch { /* not empty, or not there */ }
  console.log(did.length ? did.join('\n') : 'Nothing of the setup’s is in this folder.');
  const copies = ['.mcp.json', '.claude/settings.json', 'CLAUDE.md'].flatMap((path) => [path + COPY, path + '.lattice-backup']).filter((path) => existsSync(abs(path)));
  if (todo.length) console.log(`\nArchipelago is out of ${here}. The map on the server was not touched.${copies.length ? ` The copies the setup kept are still here: ${copies.join(', ')}.` : ''}`);
  if (!MACHINE) console.log(`\nThe address and token kept for this machine were left: add --machine to forget them, and revoke the token on the Workspace screen at ${ORIGIN} to end it.`);
  process.exit(0);
}

// The folders of the skill under its old name, emptied above, go too.
for (const path of ['.claude/skills/lattice-bump/references', '.claude/skills/lattice-bump']) try { rmdirSync(abs(path)); } catch { /* not empty, or not there */ }
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
    `\nMind: ${here} is not the top folder of a git repository${top ? ` (that is ${top})` : ''}. A session reports to Archipelago only when Claude Code is opened in the folder this was run in: run it in each repository's own folder.`,
  );
if (carried && !DRY) console.log(`\nThis machine kept its token as ${OLD_NAMES[1]}. It is now kept as ${NAMES[1]} as well, and .mcp.json reads the old name until Claude Code has been opened again: run this once more after that.`);
console.log(
  token || !TOKENS
    ? `\nConnected to ${ORIGIN}${token ? '' : ', which asks for no token'}. Quit Claude Code completely${process.platform === 'win32' ? ' (from the system tray too)' : ''}, open it again in this folder, and the session will say it is registered in Archipelago.`
    : `\nThe files are in place, but this machine has no token yet. On the Workspace screen at ${ORIGIN}, press Connect an agent and run the command it gives under 1, in this folder.`,
);
