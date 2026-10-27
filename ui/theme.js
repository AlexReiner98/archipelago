// The page's colours, light and dark, are the style's theme, its lengths the style's lengths, and its text the style's
// faces and text roles (type); the house style names every one, and /layout.css holds the lengths, faces and roles
// until the style is read. Each is set on the page as --<name>, the colours for the scheme the reader's system is in,
// set again when that changes. Only a plain hex colour, a plain length and a plain list of families are: a style is
// written by anyone who can change the map.

const dark = matchMedia('(prefers-color-scheme: dark)');
const NAME = /^[a-z][a-z0-9_]*$/;
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const FACE = /^[A-Za-z0-9 ,'"-]+$/;
const TRACK = /^-?\d+(\.\d+)?em$/;
const asLength = (v) => (typeof v === 'number' && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);

/**
 * A style's faces and text roles as the variables every stylesheet reads, the page's and its drawings' alike: each face
 * as --face-<name>, and each role (region, water, wordmark...) as --type-<role>-family, -weight, -style, -case and
 * -track, its family one of the faces. What a role does not say is the plain text's.
 */
export function typeVars(type, faces) {
  const out = [];
  const face = (name) => (NAME.test(String(name)) && typeof faces?.[name] === 'string' && FACE.test(faces[name]) ? `var(--face-${String(name).replaceAll('_', '-')})` : 'var(--face-text)');
  for (const [name, value] of Object.entries(faces ?? {})) if (NAME.test(name) && typeof value === 'string' && FACE.test(value)) out.push([`--face-${name.replaceAll('_', '-')}`, value]);
  for (const [role, t] of Object.entries(type ?? {})) {
    if (!NAME.test(role) || !t || typeof t !== 'object') continue;
    const at = `--type-${role.replaceAll('_', '-')}`;
    out.push([`${at}-family`, face(t.face)]);
    out.push([`${at}-weight`, [400, 600].includes(t.weight) ? String(t.weight) : '400']);
    out.push([`${at}-style`, t.style === 'italic' ? 'italic' : 'normal']);
    out.push([`${at}-case`, t.case === 'upper' ? 'uppercase' : 'none']);
    out.push([`${at}-track`, typeof t.track === 'string' && TRACK.test(t.track) ? t.track : '0em']);
  }
  return out;
}

let theme;
let lengths;
let text = [];
const paint = () => {
  const root = document.documentElement.style;
  for (const [name, colour] of Object.entries(theme?.[dark.matches ? 'dark' : 'light'] ?? {})) if (NAME.test(name) && /^#[0-9a-f]{3,8}$/i.test(String(colour))) root.setProperty(`--${name.replaceAll('_', '-')}`, colour);
  for (const [name, value] of Object.entries(lengths ?? {})) if (NAME.test(name) && asLength(value)) root.setProperty(`--${name.replaceAll('_', '-')}`, asLength(value));
  for (const [name, value] of text) root.setProperty(name, value);
};
dark.addEventListener('change', paint);

/** Paint the page in a style's theme, lengths, faces and text roles. */
export function applyTheme(style) {
  theme = style?.theme;
  lengths = style?.lengths;
  text = typeVars(style?.type, style?.faces);
  paint();
}
