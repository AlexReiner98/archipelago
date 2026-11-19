// One bridge from the theme to a drawing's colour roles (round 6, the palette): the three stylesheets that used to copy the
// mapping by hand hold what scripts/lens-roles.ts writes from the house style's roles, and nothing else.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { TARGETS, declarations, rolesOf, written } from '../scripts/lens-roles.ts';

const root = join(import.meta.dirname, '..');

test('each stylesheet holds the generated roles, so a role changed in the house style changes them all', () => {
  for (const t of TARGETS) {
    const css = readFileSync(join(root, t.file), 'utf8');
    assert.equal(css, written(css, t.over), `${t.file} is out of date: run node scripts/lens-roles.ts`);
  }
});

test('the status vocabulary is a role of the house, and each role names a theme colour', () => {
  const roles = rolesOf(), css = declarations({});
  for (const s of ['todo', 'active', 'waiting', 'you', 'held', 'done', 'blocked', 'ended']) {
    assert.equal(roles[`status_${s}`], `status_${s}`);
    assert.ok(css.includes(`--ln-status_${s}: var(--status-${s});`), s);
  }
  assert.equal(roles.blocked, 'status_blocked', 'the old state roles read the status names');
  assert.equal(roles.you, 'status_you');
  assert.equal(roles.done, 'status_done');
});

test('the old copies are gone: no stylesheet sets the state roles from the page’s own colours', () => {
  for (const f of ['packs/surface/page/style.css', 'packs/surface/page/doc-lens.css', 'packs/reader/public/baked.css'])
    assert.ok(!/--ln-(blocked|you|done|warn):\s*var\(--(g-blocked|g-question|ok|warn)\)/.test(readFileSync(join(root, f), 'utf8')), f);
});
