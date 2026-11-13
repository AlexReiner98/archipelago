// The rule for where a show lands is the page's (packs/panes/page/pane-route.js) and the panes part's own copy
// (packs/panes/parts/route.js), since a part shares no code with the page: the two say the same, word for word.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const routeOf = (file: string) => {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return text.slice(text.indexOf('export function route('));
};

test("the panes part lands a show by the page's own rule", () => {
  assert.equal(routeOf('packs/panes/parts/route.js'), routeOf('packs/panes/page/pane-route.js'));
});
