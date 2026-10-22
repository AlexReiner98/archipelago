// The page that hands GitHub the app's manifest: asked for it with the one-time word this page was opened with, it
// sends the form to GitHub, where the server's owner names the app and creates it.

const said = (text) => (document.getElementById('said').textContent = text);
const state = new URLSearchParams(location.search).get('state') ?? '';
const res = await fetch('/x/github_app/manifest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) }).catch(() => null);
const { result, error } = res ? await res.json().catch(() => ({ error: 'The server answered with something that is not JSON.' })) : { error: 'The server could not be reached.' };
if (error || !result) said(error ?? 'Nothing came back.');
else {
  const form = document.forms[0];
  form.action = result.action;
  form.elements.manifest.value = JSON.stringify(result.manifest);
  form.submit();
}
