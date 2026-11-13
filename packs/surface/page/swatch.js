// What a part's swatch and a button that tries a theme ask of the page (packs/walls/page/part-render.js). A part paints
// no colour: it names a style preset, and the page paints its paper, ink and sea for the scheme the screen is in, from
// the preset itself. A try paints this screen alone in a theme and keeps nothing; '' puts the workspace's own back.

import { state } from './base.js';
import { loadSchema } from './words.js';

const HEX = /^#[0-9a-f]{3,8}$/i;

/** Paper, ink and sea of a preset's colours for the scheme the screen is in: a theme's own, or the house's names. */
export function swatchColours(preset, dark) {
  const c = preset?.props?.theme?.[dark ? 'dark' : 'light'] ?? {};
  const pick = (...names) => names.map((n) => c[n]).find((v) => HEX.test(String(v ?? '')));
  return { paper: pick('paper', 'bg'), ink: pick('ink', 'text'), sea: pick('sea', 'accent') };
}

/** Paint preset `id` into `el`: Aa in its ink on its paper, a line of its sea. A preset the page does not know is drawn blank. */
export function paintSwatch(id, el) {
  const preset = (state.schema?.styles ?? []).find((s) => s.id === id);
  const { paper, ink, sea } = swatchColours(preset, matchMedia('(prefers-color-scheme: dark)').matches);
  const paint = Object.assign(document.createElement('span'), { className: 'pm-swatch-paint', textContent: 'Aa' });
  const line = Object.assign(document.createElement('span'), { className: 'pm-swatch-sea' });
  paint.append(line);
  if (paper) paint.style.background = paper;
  if (ink) paint.style.color = ink;
  if (sea) line.style.background = sea;
  el.replaceChildren(paint);
}

/** Paint this screen in preset `id`, or in the workspace's own again (''): a read, nothing kept. Only a theme (a preset used once chosen) is tried. */
export async function tryTheme(id) {
  if (id && (state.schema?.styles ?? []).find((s) => s.id === id)?.over !== 'chosen') throw new Error(`${id} is not a theme to try`);
  state.trying = id || null;
  try {
    await loadSchema();
  } catch (err) {
    state.trying = null;
    throw err;
  }
}
