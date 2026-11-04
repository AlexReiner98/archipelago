// What the tests of the tabs at the top of the owner's page share (test/tabs*.test.ts, test/show-*.test.ts): each test
// in a file of its own, so that the steps a server keeps, and a Chrome, are a test's alone, and CI deals them apart.

import type { Page } from './browser.ts';

export const agent = 'agent:claude-code/archipelago';
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A session as the page calls it, without the run it adds when another session goes by the same title. */
export const called = (names: string[]) => names.map((n) => n.replace(/ · \w{4}$/, ''));

/** A press of the middle of what `selector` finds, as a mouse makes it: down and up. */
export async function press(page: Page, selector: string, target?: string) {
  const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, target);
}
