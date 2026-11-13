// The host's page (decision e_fxayrhma, the owner, 12 Nov 2026): the modules of the page that keep humans in control
// live in the root packs' page/ folders, protected by the roots' hashes, and import one way along packs/roots.json, as
// the roots' kernels do. A host module that imports a module of the app (ui/, to become a part) or of a root after its
// own is counted; the count is frozen per file and only falls, each import going as its module becomes a part or what
// it needs moves to the host (task e_qhrvu922).

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pageImports, ratchet, ROOT, rootOrder, uiFiles, VENDORED, walk } from './structure-kit.ts';

/** A served path's root, and so its place in the order; none for the app's own files. */
const rootOf = (path: string) => /^packs\/([\w-]+)\/page\//.exec(path)?.[1];

// Emptied 13 Nov 2026 (task e_bjeev9py, the port's last step): the page kit every root draws with (base, theme, words,
// dom, body, text, menu-place, plates) is its own root, kit, before identity; the page's entry (app.js) is the last root,
// shell; the host's readers of what the panes publish (tabs.js, pane-route.js) are surface's; what a root needs of a
// later one it asks by name (hooks: partsRuntime, passwordPage, store, savedCanvases, canvasAt, mayLeave). Nothing
// imports against the order, and a new entry is never added: ask by name, or move the module to the root it belongs after.
const AGAINST_THE_ORDER: Record<string, number> = {};

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

// Between packs, names, never files (the owner, 13 Nov 2026, bug e_g6ban2ex): the app (ui/, every module of it meant
// to become a part of a map pack, its moves_to on the Pack anatomy island) asks the host for what it needs by name, a
// slot, a piece or a service the bridge offers, not by importing a host module. The count is frozen per file and only
// falls, each import going as its module becomes a part or what it needs is offered by name.
//
// Frozen again 13 Nov 2026, as the runtime moved out of ui/ (task e_6hhx2ub8, decision e_6d2g62tg): eleven modules
// left ui/ and their entries went with them; a module still in ui/ that imports one of them counts it from now on,
// and that import goes when its own cluster makes it a part of a map pack. A number here may be re-frozen only when
// the boundary itself moves, as it did here and on 12 Nov; otherwise it falls. It moved once more the same day:
// doc-lens.js, the picture mark's drawing, went to surface (task e_atxefw2s), so doc.js and item-doc.js count it.

/** Whether a served path is the host's: a root pack's page/ folder. */
const isHost = (path: string) => rootOf(path) !== undefined;

// The page is packs alone (the owner, 13 Nov 2026: everything a part, flat like the back end): ui/ is gone, every module a
// part of a map pack or a root pack's own (task e_m6frzed9). Nothing brings it back.
test("the page has no ui/ folder: every module is a pack's", () => {
  assert.ok(!existsSync(join(ROOT, 'ui')), "Put a module of the page in a pack: a part in a map pack, or a root pack's page/ if it is the runtime.");
});

// A part (a map pack's parts/, run walled, its manifest's parts) imports only its own pack's files: everything else it
// asks for by name. None reaches out today, and none may.
test('a part imports only its own pack', () => {
  const out: string[] = [];
  for (const f of walk('packs').filter((f) => /^packs\/[\w-]+\/parts\/.+\.js$/.test(f) && !/\.test\./.test(f))) {
    const pack = f.split('/')[1];
    for (const to of pageImports(f)) if (!to.startsWith(`packs/${pack}/`)) out.push(`${f} imports ${to}`);
  }
  assert.deepEqual(out, [], "A part asks for what is not its pack's by name: a slot, the fields it reads, the actions it sends.");
});
