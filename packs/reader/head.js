// A published page's head, for search engines and where a link to it is posted: its title, a description from the
// first paragraph it opens on, the address to keep and the picture its style names. And its data in the page itself,
// after its script, so the page draws its text and its pictures' first frames as soon as its scripts are here.

const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** What a search engine shows under the title: the first paragraph the document opens on, as plain words, cut short. */
export function describe(parts, most = 160) {
  for (const part of parts) {
    const text = 'text' in part ? part.text : 'section' in part ? part.section.body : '';
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.split('\n').map((line) => line.trim()).filter((line) => line && !/^#/.test(line) && !/^\|/.test(line));
      // A short line on its own above a paragraph is that paragraph's title (as ui/doc.js draws it).
      if (lines.length > 1 && lines[0].length <= 90 && !/[.;,:!?]$/.test(lines[0]) && !/^(-|\*|\d+\.)\s/.test(lines[0])) lines.shift();
      const words = lines
        .map((line) => line.replace(/^(-|\*|\d+\.)\s+/, ''))
        .join(' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
      if (!words) continue;
      if (words.length <= most) return words;
      const cut = words.slice(0, most - 1);
      return `${cut.slice(0, cut.lastIndexOf(' ') > most / 2 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s.,;:]+$/, '')}…`;
    }
  }
  return '';
}

/**
 * The document page as a public document's: its own title, a description from its first paragraph and the address to
 * keep, and no request to be left out of a search engine's index.
 */
export function publicHead(html, doc, canonical, site, image) {
  const description = describe(doc.parts);
  // Open Graph, and a card, large when there is a picture. A picture is named only at a whole address.
  const picture = image && /^https:\/\//.test(image) ? image : undefined;
  const share = [['og:type', 'article'], ['og:title', doc.title], ['og:description', description], ['og:url', canonical], ['og:site_name', site], ['og:image', picture]];
  const head = [
    description && `<meta name="description" content="${escape(description)}" />`,
    `<link rel="canonical" href="${escape(canonical)}" />`,
    ...share.filter(([, value]) => value).map(([name, value]) => `<meta property="${name}" content="${escape(value)}" />`),
    `<meta name="twitter:card" content="${picture ? 'summary_large_image' : 'summary'}" />`,
  ].filter(Boolean).join('\n    ');
  // Put in by functions, so nothing a document says is read as a replacement pattern ($&, $').
  return html.replace(/<meta name="robots" content="noindex" \/>/, () => head).replace(/<title>[^<]*<\/title>/, () => `<title>${escape(doc.title)}</title>`);
}

/** JSON as it may stand inside a page's script element: nothing in it can close the element or open a comment. */
const inPage = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/** The page sent for a published document: its head, and its data (what /data answers) after its script. */
export function publishedPage(template, doc, canonical, site, data, image) {
  return publicHead(template, doc, canonical, site, image)
    .replace(/<main id="main">[\s\S]*?<\/main>/, () => '<main id="main"></main>')
    .replace('</body>', () => `<script type="application/json" id="page-data">${inPage(data)}</script></body>`);
}
