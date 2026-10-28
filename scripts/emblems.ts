// Draw the emblem once for each theme, in its place's colours, and keep it on the theme (packs/themes/pack.json,
// `emblem`; the house style's in packs/core/pack.json): a PNG with no ground, so it sits on any page, at over twice
// the size it is shown, as a data URL. It is the ridges sketch's Emblem preset (sketches/ridges), its palette set to
// each place. Run with the sketch served:
//   node sketches/serve.mjs   then   node scripts/emblems.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { open } from '../test/browser.ts';

const SKETCH = process.env.SKETCH ?? 'http://localhost:3210/ridges/';
/** The size it is drawn at, in pixels, before the page's scale. */
const SIZE = 64;
/** Each style's place in the sketch, every one its own. */
const PLACES: Record<string, string> = {
  'core.house': 'arctic',
  'themes.open_water': 'faroe',
  'themes.bay': 'fundyIsles',
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
/** The ground it is drawn on, left out of the picture: the sketch's neutral dark. */
const GROUND = '#161614';

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
      await new Promise((r) => setTimeout(r, 300));
      // Drawn on the neutral dark, whose fill is then left out: the land and its shallows, on nothing.
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...at) { if (String(this.fillStyle).toLowerCase() !== ${JSON.stringify(GROUND)}) fill.apply(this, at); };
      document.querySelector('[data-ground="${GROUND}"]').click();
      await new Promise((r) => setTimeout(r, 600));
      CanvasRenderingContext2D.prototype.fillRect = fill;
      const c = [...document.querySelectorAll('#sizes canvas')].find((c) => c.width === ${SIZE * 2});
      return c.toDataURL('image/png');
    })()`);
  // Put in each pack's file in place, its other lines kept as they are: a theme's props stand on one line after its
  // id, the house style's one field a line.
  for (const file of ['packs/themes/pack.json', 'packs/core/pack.json']) {
    let text = readFileSync(file, 'utf8');
    for (const { id } of (JSON.parse(text).styles as { id: string }[]).filter((s) => PLACES[s.id])) {
      const url = await drawn(PLACES[id]);
      const at = text.indexOf(`"id": "${id}"`);
      const was = /"emblem": "[^"]*"/.exec(text.slice(at));
      if (was) text = text.slice(0, at + was.index) + `"emblem": ${JSON.stringify(url)}` + text.slice(at + was.index + was[0].length);
      else {
        const props = text.indexOf('"props": {', at) + '"props": {'.length;
        text = `${text.slice(0, props)}"emblem": ${JSON.stringify(url)}, ${text.slice(props)}`;
      }
      console.log(id, PLACES[id], url.length);
    }
    writeFileSync(file, text);
  }
} finally {
  page.close();
}
