// A scene as a standalone page, for a picture of it (task e_tgmq6ffu): its marks as markup, as packs/walls/page/marks.js builds them
// but without what only a page does (keys, events, items, pulses), on the page's dark theme as far as the scene reads
// it, with the style's flow_* sizes as the variables its rules read. Pure.

const theme = `:root { --ln-land: #232323; --ln-line: #9aa0a6; --ln-text: #e8e8e8; --ln-muted: #8a8f98; --ln-you: #e0a458; --ln-font: system-ui; --accent: #6cc; }
body { margin: 0; background: #171717; color: #e8e8e8; font-family: system-ui; }`;

const esc = (t: unknown) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Marks as markup. */
export const markup = (m: any): string => {
  if (typeof m === 'string' || typeof m === 'number') return esc(m);
  if (!Array.isArray(m)) return '';
  if (typeof m[0] !== 'string') return m.map(markup).join('');
  const [tag, attrs = {}, ...kids] = m, shown = Object.entries(attrs ?? {}).filter(([k]) => !['key', 'on', 'item', 'pulse'].includes(k));
  return `<${tag}${tag === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' : ''}${shown.map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${kids.map(markup).join('')}</${tag}>`;
};

/** The page of a scene. */
export function html(scene: any, sizes: Record<string, unknown>) {
  const vars = Object.entries(sizes).filter(([k]) => k.startsWith('flow_')).map(([k, v]) => `--ln-${k.replace(/_/g, '-')}: ${typeof v === 'number' ? `${v}px` : v};`).join(' ');
  return `<!doctype html><meta charset="utf-8"><style>${theme} :root { ${vars} } ${scene?.css ?? ''}</style>${typeof scene?.svg === 'string' ? scene.svg : markup(scene?.svg)}`;
}
