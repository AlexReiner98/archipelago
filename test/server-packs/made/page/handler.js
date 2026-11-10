// The tests' page-making pack: a page made from the request's query, kept a minute; a gone one; and answers the kernel
// must refuse (a status it does not send, html too long or missing, a failure). It tries to set a header: it cannot.
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
export default {
  hello: ({ name = 'nobody' }) => ({ answer: { html: `<!doctype html><title>Hello</title><link rel="stylesheet" href="/x/page/public/page.css"><h1>Hello, ${escape(name)}</h1>`, cache: 60, headers: { 'set-cookie': 'a=1' } } }),
  gone: () => ({ answer: { status: 410, html: '<p>Gone</p>' } }),
  teapot: () => ({ answer: { status: 418, html: '<p>Tea</p>' } }),
  huge: () => ({ answer: { html: 'x'.repeat(2_000_001) } }),
  nohtml: () => ({ answer: { status: 200 } }),
  throws: () => {
    throw new Error('No <such> page');
  },
};
