// Connect the project in this folder to a Lattice server. The server hands
// this script out at GET /connect/setup.mjs with two lines in front of it:
// ORIGIN (its own address) and FILES (what to write). It is run once in each
// project, from that project's folder (the first time on a machine with the
// token carried in, which it then keeps for the machine), and can be run again: it writes only
// what is missing or has changed, and adds to .mcp.json, .claude/settings.json
// and CLAUDE.md without taking anything out of them. It holds no secret: the
// token is in the machine's environment (LATTICE_AGENT_TOKEN).
//
//   .mcp.json                         the lattice tools, for Claude Code
//   .claude/lattice-hook.mjs          tells Lattice a session started, was prompted, ended
//   .claude/settings.json             the four hooks that run it
//   .claude/skills/lattice-bump/      how to record friction with Lattice
//   .claude/lattice.md                how to work with the map, read through CLAUDE.md

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const here = process.cwd();
// Every change is worked out first and made only once all of them are known: a file that cannot be read stops
// the run with nothing written. A step is what is said of one change and, where there is one to make, how.
const plan = [];
const did = [];

function write(path, text) {
  const file = join(here, path);
  const same = existsSync(file) && readFileSync(file, 'utf8') === text;
  plan.push({
    say: `${same ? 'as it was' : 'written  '}  ${path}`,
    make: same
      ? null
      : () => {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        },
  });
}

function json(path, change) {
  const file = join(here, path);
  let was = {};
  if (existsSync(file)) {
    try {
      was = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(`${path} is there but is not JSON. Fix or remove it, then run this again. Nothing was written.`);
      process.exit(1);
    }
  }
  write(path, JSON.stringify(change(was), null, 2) + '\n');
}

json('.mcp.json', (config) => {
  config.mcpServers ??= {};
  config.mcpServers.lattice = { type: 'http', url: `\${LATTICE_URL:-${ORIGIN}}/mcp`, headers: { Authorization: 'Bearer ${LATTICE_AGENT_TOKEN:-none}' } };
  return config;
});
write('.claude/lattice-hook.mjs', FILES.hook);
json('.claude/settings.json', (config) => {
  config.hooks ??= {};
  for (const [event, name, matcher] of [['SessionStart', 'session-start', 'startup|resume|clear'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end']]) {
    const list = (config.hooks[event] ??= []);
    const command = `node .claude/lattice-hook.mjs ${name}`;
    // A hook registered at another place (an older setup, or Lattice's own repository running the script it
    // hands out) is pointed at the one written here: the other does not say which hand-out it is.
    for (const entry of list) for (const hook of entry.hooks ?? []) if (typeof hook.command === 'string' && hook.command.includes('lattice-hook.mjs')) hook.command = command;
    if (JSON.stringify(list).includes('lattice-hook.mjs')) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command }] });
  }
  return config;
});
write('.claude/skills/lattice-bump/SKILL.md', FILES.skill);
write('.claude/skills/lattice-bump/references/home.md', FILES.home);
write('.claude/lattice.md', FILES.rules);

// The first time on a machine, the command that runs this carries the token in and asks for it to be kept
// (LATTICE_SETUP_SAVE): the address and the token are then stored for this person on this machine, where Claude
// Code and the hook find them from then on. On Windows that is the user's environment; elsewhere, the shell's
// start-up file, and on a Mac also what apps opened from the Dock are given. The token is never printed.
const notKept = (err) => console.error(`The address and token could not be kept for this machine (${err.message}). Set LATTICE_URL and LATTICE_AGENT_TOKEN yourself, then run this again.`);
if (process.env.LATTICE_SETUP_SAVE && process.env.LATTICE_AGENT_TOKEN) {
  const keep = { LATTICE_URL: ORIGIN, LATTICE_AGENT_TOKEN: process.env.LATTICE_AGENT_TOKEN };
  const say = 'kept       the server’s address and the token, for this machine';
  const profile = process.env.LATTICE_SETUP_PROFILE;
  if (process.platform === 'win32' && !profile) {
    plan.push({
      say,
      machine: true,
      make: () => {
        for (const [name, value] of Object.entries(keep)) execFileSync('setx', [name, value], { stdio: 'ignore' });
      },
    });
  } else {
    try {
      const file = profile || join(homedir(), process.platform === 'darwin' || (process.env.SHELL ?? '').endsWith('zsh') ? '.zshenv' : '.profile');
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
      // A value kept before (an older token) is replaced, not left beside the new one.
      const rest = lines.filter((line) => !/^export LATTICE_(URL|AGENT_TOKEN)=/.test(line));
      while (rest.length && rest.at(-1) === '') rest.pop();
      plan.push({
        say,
        machine: true,
        make: () => {
          writeFileSync(file, [...rest, ...Object.entries(keep).map(([name, value]) => `export ${name}="${value}"`), ''].join('\n'), { mode: 0o600 });
          if (process.platform === 'darwin' && !profile) for (const [name, value] of Object.entries(keep)) try { execFileSync('launchctl', ['setenv', name, value], { stdio: 'ignore' }); } catch { /* only apps opened from the Dock miss it */ }
        },
      });
    } catch (err) {
      notKept(err);
    }
  }
}

// CLAUDE.md is the project's own: one section is added to it, once, that reads the rules in.
const claude = join(here, 'CLAUDE.md');
const had = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
// A project that keeps its own setup out of git reads the rules in from CLAUDE.local.md instead.
const localRules = join(here, 'CLAUDE.local.md');
const reads = (text) => text.includes('@.claude/lattice.md');
if (reads(had) || (existsSync(localRules) && reads(readFileSync(localRules, 'utf8')))) plan.push({ say: 'as it was  CLAUDE.md', make: null });
else
  plan.push({
    say: `${had ? 'added to ' : 'written  '}  CLAUDE.md`,
    make: () => writeFileSync(claude, `${had ? had.trimEnd() + '\n\n' : ''}## Lattice\n\nThis project's work is kept in Lattice (${ORIGIN}). How to work with it:\n\n@.claude/lattice.md\n`),
  });

// Only now is anything written. Keeping the token is the one step that may fail and leave the rest standing.
for (const step of plan) {
  try {
    step.make?.();
    did.push(step.say);
  } catch (err) {
    if (!step.machine) throw err;
    notKept(err);
  }
}

console.log(did.join('\n'));

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
