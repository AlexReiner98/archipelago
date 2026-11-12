// Installing Archipelago, by a person or by their agent: what /connect/install hands out. The page (GET
// /connect/install) is plain steps an agent asked to "install Archipelago" can follow for whichever client it is, and a
// person can read; the one line it gives runs a small script for the shell (install.ps1, install.sh) that fetches the
// installer (install.mjs: scripts/pelago-install.mjs, with this server's address and the sign-in script in front of
// it). ChatGPT and Grok Bot run in their makers' clouds, so their step is said, not run. Nothing here is secret.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** What Archipelago is called and how it is described: listing.json, as src/listing.ts reads it. */
const LISTING = JSON.parse(read('listing.json')) as { name: string; summary: string; not: string; urls: { repository: string } };

/** The client the page's example names: the first the installer sets up (its CLIENTS), so the page names none of its own. */
const EXAMPLE_CLIENT = /const CLIENTS = \[\s*'([a-z]+)'/.exec(read('scripts/pelago-install.mjs'))![1];

/** The one line a person pastes, by the shell it is pasted in. */
export const installLines = (origin: string) => ({
  windows: `irm ${origin}/connect/install.ps1 | iex`,
  unix: `curl -fsSL ${origin}/connect/install.sh | sh`,
});

/**
 * The installer, with the address it connects to and the files it writes beside the person's sign-in (~/.pelago/bin):
 * the sign-in, and the hook with what it loads, for the clients whose hooks are not a plugin's (Codex, Cursor), and the
 * working rules a project is handed (rules: the sessions pack's workingRules, src/working-rules.ts).
 */
export function installScript(origin: string, rules: string): string {
  const here = (path: string) => read(path).replace(`'http://127.0.0.1:3100'`, JSON.stringify(origin));
  const files = {
    'bin/pelago-login.mjs': here('scripts/pelago-login.mjs'),
    'bin/pelago-hook.mjs': here('scripts/pelago-hook.mjs'),
    'bin/pelago-events.mjs': read('scripts/pelago-events.mjs'),
    'bin/pelago-cursor.mjs': read('scripts/pelago-cursor.mjs'),
    'pelago.md': rules,
  };
  return `const ORIGIN = ${JSON.stringify(origin)};\nconst FILES = ${JSON.stringify(files)};\n${read('scripts/pelago-install.mjs')}`;
}

/**
 * The installer as an agent runs it, for one client and asking nothing: PowerShell's script as a block, so the
 * arguments reach it (a pipe into iex passes none), and sh's from stdin, with them after -s --. No quotes inside an
 * argument: PowerShell drops those when it hands one to a program.
 */
export const agentLines = (origin: string) => ({
  windows: (client: string) => `& ([scriptblock]::Create((irm ${origin}/connect/install.ps1))) --client ${client} --yes`,
  unix: (client: string) => `curl -fsSL ${origin}/connect/install.sh | sh -s -- --client ${client} --yes`,
});

/** For PowerShell: fetch the installer to a file, so it can be read, and run it with node. */
export const installPs1 = (origin: string) => `# Archipelago's installer for Windows: ${origin}/connect/install says what it does.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Archipelago needs Node.js 18 or later: https://nodejs.org'; return }
$file = Join-Path $env:TEMP 'pelago-install.mjs'
Invoke-WebRequest -UseBasicParsing '${origin}/connect/install.mjs' -OutFile $file
node $file @args
`;

/** For sh: the same, reading answers from the terminal when there is one, since the script itself came in on stdin. */
export const installSh = (origin: string) => `#!/bin/sh
# Archipelago's installer for macOS and Linux: ${origin}/connect/install says what it does.
set -e
command -v node >/dev/null 2>&1 || { echo 'Archipelago needs Node.js 18 or later: https://nodejs.org'; exit 1; }
dir="$(mktemp -d)"
curl -fsSL '${origin}/connect/install.mjs' -o "$dir/pelago-install.mjs"
if [ -t 1 ] && (: </dev/tty) 2>/dev/null; then node "$dir/pelago-install.mjs" "$@" </dev/tty; else node "$dir/pelago-install.mjs" "$@"; fi
`;

/** /llms.txt (llmstxt.org): what this server is, for an agent that lands on it, pointing at the install. */
export const llmsTxt = (origin: string) => `# ${LISTING.name}

> ${LISTING.summary} Agents reach it as an MCP server at ${origin}/mcp; a person reads it at ${origin}.

To set up ${LISTING.name} for a person (Claude Code, Codex, Cursor, Grok Bot, ChatGPT): connect to this server. Fetch ${origin}/connect/install and follow the section for your client; there is nothing to host and nothing to choose, so do not ask which. A person with no account makes one in the browser when it opens to sign in. Set up a server of your own only if the person asks for that. ${LISTING.not}

## Install

- [Install Archipelago](${origin}/connect/install): plain steps for each client, and the one line a person pastes
- [Installer](${origin}/connect/install.mjs): the script those steps run, to read first

## Connect

- [MCP server](${origin}/mcp): streamable HTTP, signed in through the browser (OAuth)

## Only if asked

- [Host it yourself](${LISTING.urls.repository}): the server is open source, for someone who wants to run their own
`;

/** The page: what a person or their agent does, client by client. */
export function installPage(origin: string): string {
  const line = installLines(origin);
  const run = agentLines(origin);
  return `# Install Archipelago

${LISTING.summary} It is at ${origin}. Connecting an agent takes one step and one sign-in in the browser; there is nothing to host.

## For a person

Paste one line in a terminal. It finds Claude Code, Codex and Cursor on this computer, connects each, and opens your browser once to sign in.

Windows (PowerShell):

    ${line.windows}

macOS or Linux:

    ${line.unix}

Or ask your agent: "Install Archipelago from ${origin}/connect/install".

## For an agent asked to install Archipelago

Connect to this server: find your section below and follow it. Do not ask whether to host it, and do not set up a server of your own unless the person asked for one. Tell the person, in one line, what you are about to run and that a browser window will ask them to sign in, where someone with no account chooses Start a workspace; then run it. Every command here is safe to read first: the installer is at ${origin}/connect/install.mjs.

For Claude Code, Codex or Cursor, run the installer with your shell tool, naming your client (\`claude\`, \`codex\` or \`cursor\`). On Windows, in PowerShell:

    ${run.windows(EXAMPLE_CLIENT)}

On macOS or Linux:

    ${run.unix(EXAMPLE_CLIENT)}

Add \`--dry-run\` to see what it would do, changing nothing.

### What it changes

- **Writes** your client's connection (Claude Code's plugin; Codex's and Cursor's server entry and session hooks), and ~/.pelago: the sign-in, a token in a file only this user can read, and the hook scripts.
- **Sends**, from the hooks to this server, as the session's record on the person's map: each session's start and end, its prompts, the tokens it used, the files it touched, and its folder's repository, branch and recent commits.

### Claude Code

It installs the Archipelago plugin (\`claude plugin install archipelago --marketplace AlexReiner98/archipelago\`) and waits while the person says Allow in the browser. The plugin's tools load with the next session. Until then, reach the map from this one with:

    node ~/.pelago/bin/pelago-login.mjs call query name=frontier

(any tool and its input: \`call <tool> name=value\`, or the input as JSON). If it reports an older \`pelago\` server in ~/.mcp.json, ask the person whether to remove it, and if yes run the same command with \`--remove-old\`.

### Codex

It runs \`codex mcp add pelago --url ${origin}/mcp\` and then \`codex mcp login pelago\`, which opens the browser, and writes the session hooks in ~/.codex/hooks.json. Tell the person to type \`/hooks\` in Codex once and allow the four Archipelago hooks. The tools load with the next session.

### Cursor

It adds \`"pelago": { "url": "${origin}/mcp" }\` to ~/.cursor/mcp.json and the session hooks to ~/.cursor/hooks.json, and opens the browser once for the hooks' sign-in. Tell the person to open Settings, MCP, and press Connect beside pelago to sign in.

### Grok Bot

Adding a server is something you do in chat: add a custom MCP server called "pelago" at ${origin}/mcp. The person presses Add, then Authorize, and signs in.

### ChatGPT

You cannot add it yourself. Tell the person: in ChatGPT, Settings, Apps, Advanced settings, turn on Developer mode; then Create app, name it Archipelago, give it the address ${origin}/mcp with OAuth, and sign in when asked. It needs a plan with Developer mode.

## Once connected

At the start of each session, call \`capture\` with action \`session_start\` (the server's instructions say how), then work from the map: \`query\` reads, \`change\` writes, \`report\` tells. The person sees it all at ${origin}.

## Host it yourself

Only for a person who asks to run their own server: it is open source, at ${LISTING.urls.repository}. Everything above connects to this one.
`;
}
