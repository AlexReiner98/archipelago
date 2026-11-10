// The tests' reader: says back the parts of the address it was handed, as a page; an id "broken" throws, and an id
// "plain" answers no page at all. Other ids answer each kind a mount may send, and some it may not. What the request
// said comes after the parts, as JSON.
const said = ({ request, ...parts }) => `${Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(';')}</p><pre>${JSON.stringify(request)}</pre><p>`;
const KINDS = {
  json: { json: { said: 'json' }, cache: 60 },
  forgood: { json: { said: 'kept' }, cache: 99_999_999 },
  pic: { picture: { content_type: 'image/png', base64: Buffer.from('png').toString('base64') }, cache: 300 },
  badpic: { picture: { content_type: 'text/html', base64: 'PHA+' } },
  text: { text: 'plain words', type: 'text/plain' },
  badtext: { text: '<p>', type: 'text/html' },
  there: { redirect: '/elsewhere', status: 301 },
  away: { redirect: '//evil.example/' },
  pass: { pass: true },
  stream: { stream: true },
  ui: { html: '<!doctype html><head><title>t</title></head><body><script type="module" src="/doc.js"></script><a href="/doc.js">a</a></body>' },
};
export default {
  page(parts) {
    if (parts.id === 'broken') throw new Error('broken on purpose');
    if (parts.id === 'plain') return { answer: { text: 'no page' } };
    if (KINDS[parts.id]) return { answer: KINDS[parts.id] };
    return { answer: { status: parts.id === 'gone' ? 404 : 200, html: `<!doctype html><p>${said(parts)}</p>` } };
  },
  site: (parts) => ({ answer: parts.path === '/pass' ? { pass: true } : { html: `<!doctype html><p>site ${said(parts)}</p>` } }),
};
