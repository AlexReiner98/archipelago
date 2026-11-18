// What the page calls a session (packs/surface/page/pane-route.js): a show lit in the island side bar names its
// session by its chat's title, heard from its steps and from the chats open now. The tabs went on 18 Nov 2026
// (decision e_mnuthcap): a show never moves the view, so no rule of where one lands is left.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// A UI module, plain JavaScript with no types of its own.
const { hear, heard, hearOpen, nameOf } = (await import(`../packs/surface/page/${'pane-route.js'}`)) as {
  nameOf: (key: string) => string;
  hear: (step: object) => void;
  heard: Map<string, { called: string; quiet?: boolean }>;
  hearOpen: (open: object[]) => void;
};

const now = 1_000_000;

test("a session is called by its chat's title, never by its word", () => {
  heard.clear();
  hear({ actor: 'agent:a', run: 'e_ended000', name: 'Kos', title: 'Fix the solver', at: 300 });
  hear({ actor: 'agent:a', run: 'e_working0', name: 'Mull', at: 200 });
  hear({ actor: 'agent:none', at: now - 1000 });
  hear({ actor: 'agent:long', at: now - 700_000 });
  assert.equal(nameOf('e_ended000'), 'Fix the solver');
  assert.equal(nameOf('e_working0'), 'a', "with no title yet, its agent's name, never its word");
  hearOpen([
    { id: 'e_working0', title: 'Session in Apex repo', last_seen: new Date(200).toISOString() },
    { id: 'e_quiet000', name: 'Hoy', title: 'Quiet one', stale: true, last_seen: new Date(100).toISOString() },
  ]);
  assert.deepEqual([nameOf('e_working0'), nameOf('e_quiet000'), heard.get('e_quiet000')!.quiet], ['Session in Apex repo', 'Quiet one', true]);
  // A rename reaches the page with its next step.
  hear({ actor: 'agent:a', run: 'e_working0', title: 'Renamed', at: 500 });
  assert.equal(nameOf('e_working0'), 'Renamed');
  // Two open by one title are told apart.
  hear({ actor: 'agent:a', run: 'e_twin0000', title: 'Quiet one', at: 800 });
  assert.equal(nameOf('e_twin0000'), 'Quiet one · 0000');
  heard.clear();
});
