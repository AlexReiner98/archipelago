// What the tests of the tabs at the top of the owner's page share (test/tabs*.test.ts, test/show-*.test.ts): each test
// in a file of its own, so that the steps a server keeps, and a Chrome, are a test's alone, and CI deals them apart.

import { pageModule, type Page } from './browser.ts';

export const agent = 'agent:claude-code/archipelago';
export { wait } from './wait.ts';

/** The page has asked the server once more and done what it answered (ui/live.js checkTail, which it asks itself
 * every two seconds): what agents did before this has reached it. A wait for that, not for two seconds and more. */
export const heard = (page: Page) =>
  page.evaluate(`(async () => {
    const live = await ${pageModule('live.js')};
    for (let n = 0; n < 400 && (live.redrawing || document.hidden); n++) await new Promise((r) => setTimeout(r, 25));
    await live.checkTail();
    for (let n = 0; n < 400 && live.redrawing; n++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`);

/** The page is up, its tabs drawn, and has heard the server: it follows agents' steps from here on. */
export async function ready(page: Page) {
  if (!(await page.until(`Boolean(document.querySelector('#tabs .tab'))`))) throw new Error(`the page did not start: ${page.logs().join('\n')}`);
  await heard(page);
}

/** A session as the page calls it, without the run it adds when another session goes by the same title. */
export const called = (names: string[]) => names.map((n) => n.replace(/ · \w{4}$/, ''));

/** A press of the middle of what `selector` finds, as a mouse makes it: down and up. */
export async function press(page: Page, selector: string, target?: string) {
  const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, target);
}
