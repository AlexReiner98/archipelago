// Which map `npm run pull -- <name>` copies: the MCP server of that name, as Claude Code reaches it from here.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connection } from '../src/pull.ts';

test('a named map is found from a folder under its project, nearest first, with its token read from the environment', () => {
  const home = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
  const repo = join(home, 'repo'), tree = join(repo, '.claude', 'worktrees', 'one');
  mkdirSync(tree, { recursive: true });
  const server = (url: string, auth: string) => ({ type: 'http', url, headers: { Authorization: auth } });
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { site: server('https://wrong.example/mcp', 'Bearer user') },
      projects: {
        [home.replaceAll('\\', '/')]: { mcpServers: { site: server('https://outer.example/mcp', 'Bearer outer') } },
        [repo]: { mcpServers: { site: server('https://site.example/mcp', 'Bearer ${SITE_TOKEN:-none}') } },
      },
    }),
  );
  assert.deepEqual(connection('site', tree, home, { SITE_TOKEN: 'secret' }), { url: 'https://site.example', token: 'secret' });
  assert.deepEqual(connection('site', tree, home, {}), { url: 'https://site.example', token: 'none' });
  assert.deepEqual(connection('site', home, home, {}), { url: 'https://outer.example', token: 'outer' });
  // A project's .mcp.json comes before them all; a name nobody has is no map.
  writeFileSync(join(tree, '.mcp.json'), JSON.stringify({ mcpServers: { site: server('https://here.example/mcp/', 'Bearer here') } }));
  assert.deepEqual(connection('site', tree, home, {}), { url: 'https://here.example', token: 'here' });
  assert.equal(connection('other', tree, home, {}), undefined);
});
