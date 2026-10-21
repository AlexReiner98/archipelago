// The Workspace screen's Model card: the account this workspace's model calls run on (src/model-account.ts). An
// admin connects one in a line: which kind, its key, the model, and for any other server its address. It is tried
// before it is kept, and only the key's last four characters ever come back.

import { api, ask, h } from './base.js';
import { menu } from './words.js';

const KINDS = [
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['compatible', 'Other (OpenAI-compatible)'],
];
const ONE_LINE = 'min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap';
const FIELD = 'flex: 1; min-width: var(--input-least)';

export function modelCard() {
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  const fail = (err) => body.replaceChildren(h('div', { class: 'error', style: 'padding: var(--space-6) var(--space-8)' }, err.message));

  // The form, in one toolbar: what is asked for changes with the kind of account.
  const form = (s, again) => {
    const kind = h('select', { title: 'Who the account is with' }, KINDS.map(([v, label]) => h('option', { value: v, selected: v === (s.account?.provider ?? 'anthropic') }, label)));
    const url = h('input', { type: 'text', placeholder: 'https://api.example.com/v1', title: 'The server’s address, up to and including its version', style: FIELD, autocomplete: 'off', spellcheck: false });
    const key = h('input', { type: 'password', placeholder: 'API key', title: 'Kept sealed on the server. Only its last four characters are shown again.', style: FIELD, autocomplete: 'off', spellcheck: false });
    const model = h('input', { type: 'text', style: FIELD, autocomplete: 'off', spellcheck: false });
    const save = h('button', { class: 'primary', title: 'It is tried first, and not kept if it does not answer' }, 'Connect');
    const said = h('div');
    const shape = () => {
      url.hidden = kind.value !== 'compatible';
      key.placeholder = kind.value === 'compatible' ? 'API key (if it needs one)' : 'API key';
      model.placeholder = kind.value === 'anthropic' ? `Model (${s.default_model})` : 'Model, e.g. gpt-5 or mistral-small';
      model.title = kind.value === 'anthropic' ? `Left empty: ${s.default_model}` : 'The model’s name, as the account names it';
    };
    kind.onchange = shape;
    shape();
    // Replacing: what is not secret is filled in as it was; the key is typed again.
    url.value = s.account?.url ?? '';
    model.value = s.account && s.account.provider !== 'anthropic' ? s.account.model : '';
    save.onclick = async () => {
      save.disabled = true;
      save.textContent = 'Trying…';
      try {
        const v = kind.value;
        draw(await api('model_account', { provider: v, key: key.value.trim() || undefined, model: model.value.trim() || undefined, url: v === 'compatible' ? url.value.trim() : undefined }));
      } catch (err) {
        said.replaceChildren(h('div', { class: 'error', style: `padding: 0 var(--space-8) var(--space-7); ${ONE_LINE}`, title: err.message }, err.message));
        save.disabled = false;
        save.textContent = 'Connect';
      }
    };
    return [h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, kind, url, key, model, save, again && h('button', { onclick: () => draw(s) }, 'Cancel')), said];
  };

  const draw = (s) => {
    const a = s.account;
    const disconnect = async () => {
      if (!(await ask({ title: 'Disconnect the model account?', message: s.server_model ? 'Model calls here run on the server’s model again.' : 'Nothing here can ask a model until another is connected.', action: 'Disconnect', danger: true }))) return;
      api('model_account', { remove: true }).then(draw, fail);
    };
    const what = a ? [a.name, a.url && new URL(a.url).host, a.model].filter(Boolean).join(' · ') : s.server_model ? `the server’s model · ${s.server_model}` : 'no model';
    const row = h(
      'li',
      { class: 'row-top', style: 'flex-wrap: nowrap' },
      h(
        'span',
        { class: `pill ${a ? 'ok' : s.server_model ? '' : 'warn'}`, title: a ? 'Model calls here run on this account' : s.server_model ? 'Until an account is connected, this server’s own model is used' : 'Nothing here can ask a model: pushes are recorded, not read' },
        a ? 'connected' : s.server_model ? 'server' : 'none',
      ),
      h('span', { class: 'grow', style: ONE_LINE, title: a?.url ?? what }, what),
      a?.key && h('code', { class: 'muted small', title: 'The end of the key, all that is shown of it' }, a.key),
      a ? menu('More', [['Replace', () => body.replaceChildren(h('ul', { class: 'rows' }, row), ...form(s, true))], ['Disconnect', disconnect, 'danger']]) : '',
    );
    body.replaceChildren(h('ul', { class: 'rows' }, row), ...(a ? [] : form(s, false)));
  };

  api('model_account').then(draw, fail);
  // Not clipped: the row's menu opens below the card's last line.
  return h('section', { class: 'card wide', style: 'overflow: visible' }, h('header', {}, h('h2', { class: 'hinted', title: 'The account this workspace asks a model on, and pays with: the agent that reads pushes runs on it. Anthropic, OpenAI, or any server that answers as OpenAI does.' }, 'Model')), body);
}
