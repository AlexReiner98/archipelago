// The page's colours, light and dark, are the style's theme (the house style names every one). Each is set on the
// page as --<name>, for the scheme the reader's system is in, and set again when that changes. Only a plain hex
// colour is: a style is written by anyone who can change the map.

const dark = matchMedia('(prefers-color-scheme: dark)');
let theme;
const paint = () => {
  const root = document.documentElement.style;
  for (const [name, colour] of Object.entries(theme?.[dark.matches ? 'dark' : 'light'] ?? {})) if (/^[a-z][a-z0-9_]*$/.test(name) && /^#[0-9a-f]{3,8}$/i.test(String(colour))) root.setProperty(`--${name.replaceAll('_', '-')}`, colour);
};
dark.addEventListener('change', paint);

/** Paint the page in a style's theme. */
export function applyTheme(style) {
  theme = style?.theme;
  paint();
}
