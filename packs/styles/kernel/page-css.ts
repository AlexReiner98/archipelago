// A copy of src/css-check.ts (the walls' cssCheck), which a pack may not import: what a published page's stylesheet
// (page_css) may say, checked again where its look is read (pageLook). Keep the two the same: the walls' is the one the
// page and the write path use, and test/styles-css.test.ts holds this one to it.

/** What a sheet may not hold, and how each is named when it does. A page's may look at what a part holds (:has), which a drawing may not: that is how a drawing would reach past its host. */
const REFUSED: { re: RegExp; drawing?: boolean; what: (m: string) => string }[] = [
  { re: /[\\"'&<]/, what: (m) => `the character ${m}` },
  { re: /@(import|font-face|namespace|property|keyframes|layer|page|scope|charset)/i, what: (m) => m },
  { re: /url\(|image-set\(|:host|:root|expression\(/i, what: (m) => m },
  { re: /:has\(/i, drawing: true, what: (m) => m },
  { re: /(^|[{};,])\s*[~+>]/, what: (m) => `a selector that starts with ${m.trim().slice(-1)}` },
];

/** A sheet with its comments taken out: what is checked, and what is read. */
const uncommented = (text: unknown) => String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

/** What is wrong with a stylesheet as a drawing or (`page`) a published page may say it, with the line it is on, or nothing. */
export function cssProblem(text: unknown, page = false): string | undefined {
  const css = uncommented(text);
  const line = (at: number) => css.slice(0, at).split('\n').length;
  for (const rule of REFUSED) {
    if (page && rule.drawing) continue;
    const m = rule.re.exec(css);
    if (m) return `${rule.what(m[0])} (line ${line(m.index + m[0].length - 1)})`;
  }
  let depth = 0;
  for (let i = 0; i < css.length; i++) if ((depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0) < 0) return `a } that closes nothing (line ${line(i)})`;
  return depth ? 'a { that is never closed' : undefined;
}
