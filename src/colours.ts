// A style's colours (theme), finished on the server: what every page, published or not, and every agent reads. A
// style gives some colours and says how the rest follow from them, as data; this is the mechanism, with no colour and
// no share or ratio of its own (those are the presets' and the map's).
//
// A theme is { light, dark, derive }: light and dark each name colours, and derive names colours for both. A colour is
//   "#rrggbb"                                   itself;
//   "name"                                      the colour of that name, in the same scheme;
//   { mix: [a, b], share }                      a and b mixed, share of a (0 to 1);
//   { search: a, on: b | [b...], ratio }        a made lighter or darker, hue kept, until it holds ratio:1 on each b;
//   { light: colour, dark: colour }             one for each scheme.
// share, ratio and on may be { light, dark } as well, and a, b may be any colour above. Layers merge name by name, the
// nearest last: a name a nearer layer gives, in light, dark or derive, is its, whatever the farther ones said.

type Scheme = 'light' | 'dark';
type Rgb = [number, number, number];
export type Theme = Record<Scheme, Record<string, string>>;

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT = /^#[0-9a-f]{3}$/i;
const NAME = /^[a-z][a-z0-9_]*$/;
const SCHEMES: Scheme[] = ['light', 'dark'];

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** One layer's theme as a colour for each name in each scheme, its derive under its light and dark. */
function layer(theme: unknown): Record<Scheme, Record<string, unknown>> {
  const t = isObject(theme) ? theme : {};
  const derive = isObject(t.derive) ? t.derive : {};
  return { light: { ...derive, ...(isObject(t.light) ? t.light : {}) }, dark: { ...derive, ...(isObject(t.dark) ? t.dark : {}) } };
}

/** Two themes as one, the top's names over the base's, each scheme name by name. Not finished: what it says is kept to be merged again. */
export function mergeTheme(base: unknown, top: unknown): Record<Scheme, Record<string, unknown>> {
  const a = layer(base), b = layer(top);
  return { light: { ...a.light, ...b.light }, dark: { ...a.dark, ...b.dark } };
}

// ---- colour arithmetic --------------------------------------------------------------------------

const toRgb = (hex: string): Rgb => {
  const h = SHORT.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0')).join('')}`;
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG's relative luminance of a colour. */
export const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG's contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** sRGB to OKLab (Björn Ottosson), and back: lightness kept apart from hue, as the eye sees it. */
function toLab(hex: string): Rgb {
  const [r, g, b] = toRgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** A colour at lightness L with the hue of `lab`, as much of its chroma as sRGB can show there. */
function atLightness(lab: Rgb, L: number): string {
  let lo = 0, hi = 1;
  if (!inGamut(fromLab([L, lab[1], lab[2]])))
    for (let i = 0; i < 20; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(fromLab([L, lab[1] * k, lab[2] * k]))) lo = k;
      else hi = k;
    }
  else lo = 1;
  return toHex(fromLab([L, lab[1] * lo, lab[2] * lo]).map(gamma) as Rgb);
}

/** `start` made darker on light grounds or lighter on dark ones, as little as it takes to hold `ratio` on each ground. */
export function search(start: string, grounds: string[], ratio: number): string {
  const holds = (c: string) => grounds.every((g) => contrast(c, g) >= ratio);
  if (holds(start)) return start;
  // A ground nearer white than black is light: darken on it.
  const darken = contrast(grounds[0], '#000000') >= contrast(grounds[0], '#ffffff');
  const lab = toLab(start);
  let near = lab[0], far = darken ? 0 : 1;
  if (!holds(atLightness(lab, far))) return atLightness(lab, far);
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (holds(atLightness(lab, mid))) far = mid;
    else near = mid;
  }
  return atLightness(lab, far);
}

/** Two colours mixed: `share` of a, the rest b. */
export function mix(a: string, b: string, share: number): string {
  const x = toRgb(a), y = toRgb(b), s = clamp(share);
  return toHex(x.map((c, i) => c * s + y[i] * (1 - s)) as Rgb);
}

// ---- finishing ----------------------------------------------------------------------------------

/** A theme's colours of one scheme, each one worked out: a name that cannot be (unknown, circular, malformed) is left out. */
export function finishScheme(given: Record<string, unknown>, scheme: Scheme): Record<string, string> {
  const done = new Map<string, string | null>();
  const pick = (v: unknown) => (isObject(v) && ('light' in v || 'dark' in v) && !('mix' in v) && !('search' in v) ? v[scheme] : v);
  const num = (v: unknown) => (typeof pick(v) === 'number' ? (pick(v) as number) : NaN);
  const colour = (v: unknown, path: Set<string>): string | null => {
    v = pick(v);
    if (typeof v === 'string') {
      if (HEX.test(v) || SHORT.test(v)) return toHex(toRgb(v));
      return NAME.test(v) ? named(v, path) : null;
    }
    if (!isObject(v)) return null;
    if (Array.isArray(v.mix) && v.mix.length === 2) {
      const [a, b] = v.mix.map((c) => colour(c, path)), share = num(v.share);
      return a && b && Number.isFinite(share) ? mix(a, b, share) : null;
    }
    if ('search' in v) {
      const start = colour(v.search, path), ratio = num(v.ratio);
      const on = pick(v.on), grounds = (Array.isArray(on) ? on : [on]).map((g) => colour(g, path));
      return start && grounds.length && grounds.every(Boolean) && Number.isFinite(ratio) ? search(start, grounds as string[], ratio) : null;
    }
    return null;
  };
  const named = (name: string, path: Set<string>): string | null => {
    if (done.has(name)) return done.get(name)!;
    if (path.has(name) || !(name in given)) return null;
    const out = colour(given[name], new Set([...path, name]));
    done.set(name, out);
    return out;
  };
  const out: Record<string, string> = {};
  for (const name of Object.keys(given)) {
    const c = NAME.test(name) ? named(name, new Set()) : null;
    if (c) out[name] = c;
  }
  return out;
}

/** A theme's colours as the page paints them: every name a hex colour, light and dark. */
export function finishTheme(theme: unknown): Theme {
  const t = layer(theme);
  return Object.fromEntries(SCHEMES.map((s) => [s, finishScheme(t[s], s)])) as Theme;
}
