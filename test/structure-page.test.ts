// The host's page (decision e_fxayrhma, the owner, 12 Nov 2026): the modules of the page that keep humans in control
// live in the root packs' page/ folders, protected by the roots' hashes, and import one way along packs/roots.json, as
// the roots' kernels do. A host module that imports a module of the app (ui/, to become a part) or of a root after its
// own is counted; the count is frozen per file and only falls, each import going as its module becomes a part or what
// it needs moves to the host (task e_qhrvu922).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageImports, ratchet, rootOrder, uiFiles, VENDORED } from './structure-kit.ts';

/** A served path's root, and so its place in the order; none for the app's own files. */
const rootOf = (path: string) => /^packs\/([\w-]+)\/page\//.exec(path)?.[1];

// Frozen 12 Nov 2026, as the host moved out of ui/: mostly words.js and the canvas's modules, and base.js, the page's
// fetch and ask, which sits in surface, the last root (the owner agreed it stays there, 12 Nov 2026).
const AGAINST_THE_ORDER: Record<string, number> = {
  'packs/identity/page/agents-card.js': 2,
  'packs/identity/page/authorize.js': 1,
  'packs/identity/page/members-card.js': 2,
  'packs/identity/page/password.js': 1,
  'packs/identity/page/token-ask.js': 2,
  'packs/identity/page/token-piece.js': 2,
  'packs/identity/page/workspace-cards.js': 3,
  'packs/identity/page/workspace.js': 7,
  'packs/identity/page/workspaces-card.js': 2,
  'packs/walls/page/layout-asks.js': 4,
  'packs/walls/page/layout.js': 11,
  'packs/walls/page/marks.js': 3,
  'packs/walls/page/surface.js': 1,
  'packs/loader/page/packs.js': 5,
  'packs/loader/page/page-schema.js': 2,
  'packs/write/page/held-card.js': 2,
  'packs/write/page/held.js': 3,
  'packs/write/page/item-held.js': 3,
  'packs/surface/page/base.js': 1,
  'packs/surface/page/live.js': 9,
  'packs/surface/page/replica.js': 1,
};

test("the host's page imports one way along roots.json", () => {
  const counted: Record<string, number> = {};
  for (const f of uiFiles.filter((f) => rootOf(f) && f.endsWith('.js') && !VENDORED.includes(f))) {
    const at = rootOrder.indexOf(rootOf(f)!);
    const against = pageImports(f).filter((to) => {
      const root = rootOf(to);
      return root === undefined || rootOrder.indexOf(root) > at;
    }).length;
    if (against) counted[f] = against;
  }
  assert.deepEqual(ratchet(counted, AGAINST_THE_ORDER), [], "Import from the host's page in a root at or before this one in packs/roots.json, or take what is needed in.");
});
