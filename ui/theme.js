// The page's colours, light and dark, are the style's theme, and its lengths the style's lengths (the house style
// names every one; /layout.css holds its lengths until the style is read). Each is set on the page as --<name>, the
// colours for the scheme the reader's system is in, set again when that changes. Only a plain hex colour and a plain
// length are: a style is written by anyone who can change the map.

const dark = matchMedia('(prefers-color-scheme: dark)');
const NAME = /^[a-z][a-z0-9_]*$/;
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const asLength = (v) => (typeof v === 'number' && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);
let theme;
let lengths;
const paint = () => {
  const root = document.documentElement.style;
  for (const [name, colour] of Object.entries(theme?.[dark.matches ? 'dark' : 'light'] ?? {})) if (NAME.test(name) && /^#[0-9a-f]{3,8}$/i.test(String(colour))) root.setProperty(`--${name.replaceAll('_', '-')}`, colour);
  for (const [name, value] of Object.entries(lengths ?? {})) if (NAME.test(name) && asLength(value)) root.setProperty(`--${name.replaceAll('_', '-')}`, asLength(value));
};
dark.addEventListener('change', paint);

/** Paint the page in a style's theme and lengths. */
export function applyTheme(style) {
  theme = style?.theme;
  lengths = style?.lengths;
  paint();
}
