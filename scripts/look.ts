// A page as a reader sees it, for an agent to look at: opened in headless Chrome, given time to draw (and a story
// time to play), and kept as a PNG the agent can read.
//   node scripts/look.ts <url> <out.png> [width=1280] [height=800] [wait=3000] [selector]
// With a selector, the page is scrolled to it once the wait is over. The PNG is what is in the window, not the whole page.

import { writeFileSync } from 'node:fs';
import { open } from '../test/browser.ts';

const [url, out, width = '1280', height = '800', wait = '3000', selector] = process.argv.slice(2);
if (!url || !out) throw new Error('node scripts/look.ts <url> <out.png> [width] [height] [wait ms] [selector]');
const page = await open('about:blank');
await page.send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: Number(width) < 768 });
await page.go(url);
await new Promise((r) => setTimeout(r, Number(wait)));
// Scrolled once what it draws has its height.
if (selector) await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView()`);
writeFileSync(out, Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
for (const line of page.logs()) console.log(line);
page.close();
process.exit(0);
