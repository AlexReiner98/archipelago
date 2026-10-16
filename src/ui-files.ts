// The files the web UI is served from, by the path a browser asks for.

export const UI_FILES: Record<string, string> = {
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
