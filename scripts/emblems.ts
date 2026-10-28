// Draw the emblem once for each theme, in its place's colours, and keep it on the theme (packs/themes/pack.json,
// `emblem`): a PNG at twice the size it is shown, as a data URL. It is the ridges sketch's Emblem preset
// (sketches/ridges), its palette set to each place. Run with the sketch served:
//   node sketches/serve.mjs   then   node scripts/emblems.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { open } from '../test/browser.ts';

const SKETCH = process.env.SKETCH ?? 'http://localhost:3210/ridges/';
/** The size it is drawn at, in pixels, before the page's scale. */
const SIZE = 64;
/** Each theme's place in the sketch; a theme of no one place keeps the preset's own. */
const PLACES: Record<string, string> = {
  'themes.haida_gwaii': 'haidaGwaii',
  'themes.galapagos': 'galapagos',
  'themes.raja_ampat': 'rajaAmpat',
  'themes.cyclades': 'cyclades',
  'themes.svalbard': 'svalbard',
  'themes.maldives': 'maldives',
  'themes.magdalen': 'magdalen',
  'themes.thousand_islands': 'thousandIslands',
  'themes.great_slave': 'greatSlave',
};
const PRESET = 'arctic';
const FILE = 'packs/themes/pack.json';

const presets = readFileSync(new URL('../sketches/ridges/presets-backup-2026-10-26.json', import.meta.url), 'utf8');
const page = await open(SKETCH);
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await page.evaluate(`localStorage.setItem('archipelago-ridges-presets', JSON.stringify(${presets}.presets))`);
  await page.go(SKETCH);
  const drawn = async (place: string) =>
    page.evaluate<string>(`(async () => {
      const s = document.getElementById('preset');
      s.value = 'Emblem'; s.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const p = document.getElementById('place');
      p.value = ${JSON.stringify(place)}; p.dispatchEvent(new Event('change', { bubbles: true })); p.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      const c = [...document.querySelectorAll('#sizes canvas')].find((c) => c.width === ${SIZE * 2});
      return c.toDataURL('image/png');
    })()`);
  // Each style's props stand on one line after its id: the emblem is put first in them, the file's lines kept as they are.
  let text = readFileSync(FILE, 'utf8');
  for (const { id } of JSON.parse(text).styles as { id: string }[]) {
    const url = await drawn(PLACES[id] ?? PRESET);
    const at = text.indexOf(`"id": "${id}"`);
    const props = text.indexOf('"props": {', at) + '"props": {'.length;
    const rest = text.slice(props).replace(/^"emblem": "[^"]*", /, '');
    text = `${text.slice(0, props)}"emblem": ${JSON.stringify(url)}, ${rest}`;
    console.log(id, url.length);
  }
  writeFileSync(FILE, text);
} finally {
  page.close();
}
