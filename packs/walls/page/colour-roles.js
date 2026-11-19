// The colour roles a drawing is given, as the packs declare them: the style's `roles`, each a theme name (or a hex),
// drawn as --ln-<role> (./query-base.js dress). A pack adds a role by naming it in a style of its own; this holds no list.

const NAME = /^[a-z][a-z0-9_]*$/;
/** The names of a style's roles. */
export const colourRoles = (style) => Object.keys(style?.roles ?? {}).filter((name) => NAME.test(name));
