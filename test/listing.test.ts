// Every listing of Archipelago says what listing.json says (src/listing.ts): the plugin and its marketplace, /llms.txt,
// the install page and the README. A directory filled in by hand is pasted from the same file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LIMITS, LISTING } from '../src/listing.ts';
import { installPage, llmsTxt } from '../src/install.ts';
import { FOLDER, PLUGIN_ICON, pluginFiles } from '../scripts/plugin.ts';

const ROOT = join(import.meta.dirname, '..');

test('the listing fits every directory', () => {
  for (const [field, most] of Object.entries(LIMITS)) assert.ok((LISTING as Record<string, unknown> & typeof LISTING)[field as keyof typeof LIMITS].length <= most, `${field} is over ${most} characters`);
  assert.ok(LISTING.title.startsWith(LISTING.name), 'the title is the name, then what tells it apart');
  assert.ok(LISTING.summary.startsWith(LISTING.tagline), 'the summary leads with the tagline');
  for (const url of Object.values(LISTING.urls)) assert.ok(/^(https:\/\/|mailto:)/.test(url), `${url} is not https or mailto`);
  const icon = readFileSync(join(ROOT, LISTING.icon));
  const [width, height] = [icon.readUInt32BE(16), icon.readUInt32BE(20)];
  assert.ok(icon.subarray(1, 4).toString() === 'PNG' && width === height && width >= 512 && width <= 2048 && icon.length < 2_000_000, 'the icon is a square PNG of 512 to 2048 px, under 2 MB');
  assert.ok(readFileSync(join(ROOT, PLUGIN_ICON)).equals(icon), 'the plugin carries the listing icon: run npm run plugin');
});

test('the plugin and its marketplace say what the listing says', () => {
  const files = pluginFiles();
  const plugin = JSON.parse(files[`${FOLDER}/.claude-plugin/plugin.json`]);
  const market = JSON.parse(files['.claude-plugin/marketplace.json']);
  assert.equal(plugin.description, LISTING.summary);
  assert.equal(market.plugins[0].description, LISTING.summary);
  assert.deepEqual(plugin.keywords, LISTING.keywords);
  assert.equal(plugin.author.name, LISTING.publisher);
  assert.equal(market.owner.name, LISTING.publisher);
});

test('what an agent reads, and the README, lead with the summary', () => {
  const origin = 'https://app.archipelago.tools';
  assert.ok(llmsTxt(origin).includes(LISTING.summary), '/llms.txt');
  assert.ok(llmsTxt(origin).includes(LISTING.not), '/llms.txt tells it from the game');
  assert.ok(installPage(origin).includes(LISTING.summary), 'the install page');
  assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes(LISTING.summary), 'README.md');
});

test('an agent asked to set it up connects to this server: it does not ask, and hosting its own comes last, if asked', () => {
  const origin = 'https://app.archipelago.tools';
  for (const [name, text] of [['/llms.txt', llmsTxt(origin)], ['the install page', installPage(origin)]]) {
    assert.match(text, /do not ask|nothing to choose/i, `${name} says not to ask which`);
    assert.match(text, /only if the person asks|unless the person asked/i, `${name}: a server of one's own only if asked`);
    assert.ok(text.lastIndexOf(LISTING.urls.repository) > text.indexOf(`${origin}/connect/install`), `${name}: hosting comes after connecting`);
  }
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.indexOf('## Connect your agent') < readme.indexOf('## Host it yourself'), 'README.md: connecting before hosting');
});
