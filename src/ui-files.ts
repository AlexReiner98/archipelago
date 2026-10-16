// The files the web UI is served from, by the path a browser asks for.

/** The app's own modules, each a part of the page (ui/app.js imports them), served at /<name>.js. */
const APP_MODULES = ['base', 'words', 'body', 'forms', 'home', 'review', 'search', 'item', 'item-doc', 'item-links', 'screens', 'graph', 'graph-draw', 'lens', 'nest', 'grid', 'gate', 'proof', 'roadmap', 'live', 'week', 'time', 'workspace', 'workspace-cards'];

export const UI_FILES: Record<string, string> = {
  ...Object.fromEntries(APP_MODULES.map((m) => [`/${m}.js`, `${m}.js`])),
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
  '/public.js': 'public.js',
  '/public.css': 'public.css',
  '/doc.js': 'doc.js',
  '/doc.css': 'doc.css',
  '/packs.js': 'packs.js',
  '/timeline.js': 'timeline.js',
  // Where a style's own drawing code runs: a page of its own in a sandboxed frame, and what it starts with.
  '/draw.html': 'draw.html',
  '/draw.js': 'draw.js',
  // three.js as its authors build it (MIT), offered to a style's code; loaded only when one asks for it.
  '/three.js': 'three.module.min.js',
};
