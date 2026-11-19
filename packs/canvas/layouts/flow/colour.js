// A colour a style gives (island and place hues, link colours, a board's fill): a hex, or the name of a theme colour,
// drawn as var(--name) so it follows the theme (the page sets each theme name as --name, an underscore a dash). Layer: marks. Pure.

/** A colour a style may name: a hex of three to eight digits, or a theme name (a pattern, not a length, so it is written as text). */
export const COLOUR = new RegExp('^(#[0-9a-f]{3,8}|[a-z][a-z0-9_]*)$', 'i');
export const isColour = (v) => typeof v === 'string' && COLOUR.test(v);
/** The css that draws a colour: a hex itself, a theme name its variable. */
export const cssColour = (v) => (v.startsWith('#') ? v : `var(--${v.replaceAll('_', '-')})`);
/** What a class says of a colour, the same colour the same class: its hex digits, or `n-` and its name. */
export const colourKey = (v) => (v.startsWith('#') ? v.slice(1).toLowerCase() : `n-${v.replaceAll('_', '-').toLowerCase()}`);
