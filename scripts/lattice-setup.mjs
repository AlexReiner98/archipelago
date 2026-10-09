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
//   .claude/settings.json             the three hooks that run it
//   .claude/skills/lattice-bump/      how to record friction with Lattice
//   .claude/lattice.md                how to work with the map, read through CLAUDE.md

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const here = process.cwd();
const did = [];

function write(path, text) {
  const file = join(here, path);
  mkdirSync(dirname(file), { recursive: true });
  const same = existsSync(file) && readFileSync(file, 'utf8') === text;
  if (!same) writeFileSync(file, text);
  did.push(`${same ? 'as it was' : 'written  '}  ${path}`);
}

function json(path, change) {
  const file = join(here, path);
  let was = {};
  if (existsSync(file)) {
    try {
      was = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(`${path} is there but is not JSON. Fix or remove it, then run this again. Nothing after it was written.`);
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
  for (const [event, name, matcher] of [['SessionStart', 'session-start', 'startup|resume|clear'], ['UserPromptSubmit', 'prompt'], ['SessionEnd', 'session-end']]) {
    const list = (config.hooks[event] ??= []);
    if (JSON.stringify(list).includes('lattice-hook.mjs')) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command: `node .claude/lattice-hook.mjs ${name}` }] });
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
if (process.env.LATTICE_SETUP_SAVE && process.env.LATTICE_AGENT_TOKEN) {
  const keep = { LATTICE_URL: ORIGIN, LATTICE_AGENT_TOKEN: process.env.LATTICE_AGENT_TOKEN };
  try {
    const profile = process.env.LATTICE_SETUP_PROFILE;
    if (process.platform === 'win32' && !profile) {
      for (const [name, value] of Object.entries(keep)) execFileSync('setx', [name, value], { stdio: 'ignore' });
    } else {
      const file = profile || join(homedir(), process.platform === 'darwin' || (process.env.SHELL ?? '').endsWith('zsh') ? '.zshenv' : '.profile');
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
      // A value kept before (an older token) is replaced, not left beside the new one.
      const rest = lines.filter((line) => !/^export LATTICE_(URL|AGENT_TOKEN)=/.test(line));
      while (rest.length && rest.at(-1) === '') rest.pop();
      writeFileSync(file, [...rest, ...Object.entries(keep).map(([name, value]) => `export ${name}="${value}"`), ''].join('\n'), { mode: 0o600 });
      if (process.platform === 'darwin' && !profile) for (const [name, value] of Object.entries(keep)) try { execFileSync('launchctl', ['setenv', name, value], { stdio: 'ignore' }); } catch { /* only apps opened from the Dock miss it */ }
    }
    did.push('kept       the server\u2019s address and the token, for this machine');
  } catch (err) {
    console.error(`The address and token could not be kept for this machine (${err.message}). Set LATTICE_URL and LATTICE_AGENT_TOKEN yourself, then run this again.`);
  }
}

// CLAUDE.md is the project's own: one section is added to it, once, that reads the rules in.
const claude = join(here, 'CLAUDE.md');
const had = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
if (had.includes('@.claude/lattice.md')) did.push('as it was  CLAUDE.md');
else {
  writeFileSync(claude, `${had ? had.trimEnd() + '\n\n' : ''}## Lattice\n\nThis project's work is kept in Lattice (${ORIGIN}). How to work with it:\n\n@.claude/lattice.md\n`);
  did.push(`${had ? 'added to ' : 'written  '}  CLAUDE.md`);
}

console.log(did.join('\n'));
console.log(
  process.env.LATTICE_AGENT_TOKEN
    ? `\nConnected to ${ORIGIN}. Quit Claude Code completely${process.platform === 'win32' ? ' (from the system tray too)' : ''}, open it again in this folder, and the session will say it is registered in Lattice.`
    : `\nThe files are in place, but this machine has no token yet. On the Workspace screen at ${ORIGIN}, press Connect an agent and run the command it gives under 1, in this folder.`,
);
