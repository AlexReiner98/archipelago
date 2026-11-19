// A state's colour is one of the theme's status names (status_todo, _active, _waiting, _you, _held, _done, _blocked, _ended),
// never the page's own warn, ok, bad, g_question or g_blocked, nor the drawing's old state roles (--ln-blocked, -you, -done,
// -warn): the app has one status vocabulary (round 6, the palette; audit e_gjezg77m). What still breaks it is listed with its count, and
// the list may only shrink: lower a number when a surface moves to the names, never raise one.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const OLD = /var\(--(?:g-blocked|g-question|warn|ok|bad)\b/g;
/** The surfaces that say a state: the canvas's drawing, the side bar and the page's marks. */
const SURFACES = ['packs/canvas/layouts', 'packs/surface/page/island-picker.css', 'packs/surface/page/doc-lens.css', 'packs/sessions', 'packs/canvas/pack.json'];

/** What breaks it now, by file: [file, count]. */
const BREAKS: Record<string, number> = {
  'packs/canvas/layouts/architecture/story-look.js': 11, // the architecture drawing's own tones, not the canvas's
  'packs/surface/page/island-picker.css': 2, // an island being on, not a status
  'packs/surface/page/doc-lens.css': 1, // a kind's colour (question), not a status
};

const files = (path: string): string[] => (statSync(join(root, path)).isDirectory() ? readdirSync(join(root, path)).flatMap((f) => files(`${path}/${f}`)) : /\.(js|css|json)$/.test(path) ? [path] : []);

test('a state colour comes from the status names; what already breaks it only shrinks', () => {
  const found: Record<string, number> = {};
  for (const f of SURFACES.flatMap(files)) {
    const n = (readFileSync(join(root, f), 'utf8').match(OLD) ?? []).length;
    if (n) found[relative(root, join(root, f)).replaceAll('\\', '/')] = n;
  }
  for (const [f, n] of Object.entries(found)) assert.ok(n <= (BREAKS[f] ?? 0), `${f} takes a state colour from ${n} places outside the status names (allowed ${BREAKS[f] ?? 0}): ${JSON.stringify(found)}`);
  for (const [f, n] of Object.entries(BREAKS)) assert.ok((found[f] ?? 0) <= n, `${f}`);
});
