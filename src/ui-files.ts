// The files the web UI is served from, by the path a browser asks for.

/** The app's own modules, each a part of the page (ui/app.js imports them), served at /<name>.js. */
const APP_MODULES = ['base', 'words', 'body', 'forms', 'home', 'held', 'search', 'item', 'item-doc', 'item-links', 'screens', 'attention', 'nav', 'graph', 'graph-draw', 'lens', 'lens-base', 'list', 'grid', 'timeline', 'style-code', 'flow', 'flow-layout', 'arch', 'arch-layout', 'pan-zoom', 'gate', 'proof', 'roadmap', 'live', 'week', 'time', 'workspace', 'workspace-cards', 'styles-card', 'token-piece', 'token-ask', 'atlas'];

export const UI_FILES: Record<string, string> = {
  ...Object.fromEntries(APP_MODULES.map((m) => [`/${m}.js`, `${m}.js`])),
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
  '/flow.css': 'flow.css',
  '/arch.css': 'arch.css',
  '/grid.css': 'grid.css',
  '/list.css': 'list.css',
  '/public.js': 'public.js',
  '/public.css': 'public.css',
  '/doc.js': 'doc.js',
  '/doc.css': 'doc.css',
  '/packs.js': 'packs.js',
  // Where a style's own drawing code runs: a page of its own in a sandboxed frame, and what it starts with.
  '/draw.html': 'draw.html',
  '/draw.js': 'draw.js',
  // three.js as its authors build it (MIT), offered to a style's code; loaded only when one asks for it.
  '/three.js': 'three.module.min.js',
};
