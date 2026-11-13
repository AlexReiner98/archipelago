// The host's page (decision e_fxayrhma, the owner, 12 Nov 2026): the modules of the page that keep humans in control
// live in the root packs' page/ folders, protected by the roots' hashes, and import one way along packs/roots.json, as
// the roots' kernels do. A host module that imports a module of the app (ui/, to become a part) or of a root after its
// own is counted; the count is frozen per file and only falls, each import going as its module becomes a part or what
// it needs moves to the host (task e_qhrvu922).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageImports, ratchet, rootOrder, uiFiles, VENDORED, walk } from './structure-kit.ts';

/** A served path's root, and so its place in the order; none for the app's own files. */
const rootOf = (path: string) => /^packs\/([\w-]+)\/page\//.exec(path)?.[1];

// Frozen again 13 Nov 2026, as the runtime moved out of ui/ (task e_6hhx2ub8, decision e_6d2g62tg): eleven modules
// stay runtime (they boot or mount, render a mark the slot contract names, or are data the runtime hands parts) and
// now sit in surface, walls and loader, so what the host used to reach into ui/ for it now has (layout.js 8 to 3,
// live.js 5). The moved modules bring their own imports of the app with them (app.js, canvas.js, query-base.js and
// the rest), each going as the module it reaches becomes a part. The panes and tabs moved to the panes root the same
// day as host code (task e_d5ewsvgf): they bring their imports of the app with them, and their ui/ entries went.
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
  'packs/walls/page/layout-tip.js': 1,
  'packs/walls/page/layout.js': 5,
  'packs/walls/page/plates.js': 1,
  'packs/walls/page/query-base.js': 2,
  'packs/walls/page/surface.js': 1,
  'packs/walls/page/view-frame.js': 1,
  'packs/loader/page/packs.js': 4,
  'packs/loader/page/page-schema.js': 1,
  'packs/loader/page/words.js': 2,
  'packs/write/page/held-card.js': 1,
  'packs/write/page/held.js': 2,
  'packs/write/page/item-held.js': 1,
  'packs/surface/page/app.js': 8,
  'packs/surface/page/canvas.js': 3,
  'packs/surface/page/live.js': 7,
  'packs/surface/page/query.js': 2,
  'packs/surface/page/replica.js': 1,
  'packs/panes/page/panes.js': 3,
  'packs/panes/page/tab-bar.js': 3,
  'packs/panes/page/tabs.js': 1,
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

// Between packs, names, never files (the owner, 13 Nov 2026, bug e_g6ban2ex): the app (ui/, every module of it meant
// to become a part of a map pack, its moves_to on the Pack anatomy island) asks the host for what it needs by name, a
// slot, a piece or a service the bridge offers, not by importing a host module. The count is frozen per file and only
// falls, each import going as its module becomes a part or what it needs is offered by name.
//
// Frozen again 13 Nov 2026, as the runtime moved out of ui/ (task e_6hhx2ub8, decision e_6d2g62tg): eleven modules
// left ui/ and their entries went with them; a module still in ui/ that imports one of them counts it from now on,
// and that import goes when its own cluster makes it a part of a map pack. A number here may be re-frozen only when
// the boundary itself moves, as it did here and on 12 Nov; otherwise it falls.
const APP_ON_HOST: Record<string, number> = {
  'ui/canvas-menu.js': 2,
  'ui/canvases.js': 5,
  'ui/catch-up.js': 3,
  'ui/connect-agent.js': 2,
  'ui/connections-card.js': 2,
  'ui/diagram.js': 3,
  'ui/doc-lens.js': 4,
  'ui/doc-sheet.js': 2,
  'ui/doc.js': 7,
  'ui/draft.js': 4,
  'ui/field-edit.js': 2,
  'ui/fields.js': 2,
  'ui/find-choices.js': 2,
  'ui/find.js': 3,
  'ui/home.js': 1,
  'ui/island-new.js': 2,
  'ui/item-doc.js': 4,
  'ui/item-links.js': 2,
  'ui/item-sections.js': 3,
  'ui/item.js': 6,
  'ui/keep-in-view.js': 2,
  'ui/limits-card.js': 1,
  'ui/link-pick.js': 2,
  'ui/look-marks.js': 1,
  'ui/look-switch.js': 3,
  'ui/nav.js': 2,
  'ui/public.js': 3,
  'ui/query-bar.js': 3,
  'ui/query-light.js': 2,
  'ui/screens.js': 8,
  'ui/sheet-follow.js': 2,
  'ui/start.js': 1,
  'ui/style-code.js': 2,
  'ui/styles-card.js': 2,
  'ui/term-kinds.js': 2,
  'ui/term-pick.js': 2,
  'ui/themes-card.js': 2,
  'ui/thumbs.js': 5,
  'ui/traces.js': 3,
};

/** Whether a served path is the host's: a root pack's page/ folder. */
const isHost = (path: string) => rootOf(path) !== undefined;

test('the app asks the host by name, not by importing its files', () => {
  const counted: Record<string, number> = {};
  for (const f of uiFiles.filter((f) => f.startsWith('ui/') && f.endsWith('.js') && !VENDORED.includes(f))) {
    const onHost = pageImports(f).filter(isHost).length;
    if (onHost) counted[f] = onHost;
  }
  assert.deepEqual(ratchet(counted, APP_ON_HOST), [], 'Ask the host by name (a slot, a piece, a service the bridge offers), or make the module a part that does.');
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
