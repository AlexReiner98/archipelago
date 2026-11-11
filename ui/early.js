// The reads every page of a workspace waits on before it can ask for what it shows (who is signed in, the schema and
// the workspace's style), asked as the page starts: this runs as soon as it is fetched, while the page's styles and
// its modules are still loading. ui/base.js takes each answer once (`early`); a page that finds none asks as before.
// It imports nothing, so nothing holds it up. A narrower session tried on a dev server (?may=) reads otherwise, and
// is left to ask for itself.

if (!new URLSearchParams(location.search).has('may')) {
  let token = '';
  try {
    token = localStorage.getItem('pelago-token') ?? '';
  } catch {
    // Storage can be blocked: the page signs in as it would.
  }
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const post = (tool, input) => fetch(`/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  globalThis.pelagoEarly = { token, whoami: fetch('/whoami', { headers }), schema: post('schema', {}), style: post('view', { name: 'style', params: {} }) };
}
