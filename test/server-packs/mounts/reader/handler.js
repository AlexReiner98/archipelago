// The tests' reader: says back the parts of the address it was handed, as a page; an id "broken" throws, and an id
// "plain" answers no page at all.
const said = (parts) => Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(';');
export default {
  page(parts) {
    if (parts.id === 'broken') throw new Error('broken on purpose');
    if (parts.id === 'plain') return { answer: { text: 'no page' } };
    return { answer: { status: parts.id === 'gone' ? 404 : 200, html: `<!doctype html><p>${said(parts)}</p>` } };
  },
  site: (parts) => ({ answer: { html: `<!doctype html><p>site ${said(parts)}</p>` } }),
};
