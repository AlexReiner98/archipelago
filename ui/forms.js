// Forms built from a type's schema.

import { api, h, part, state } from './base.js';
import { label, statusesOf, typeChoice, types, workType } from './words.js';

/** A form for any type, built from its schema. System-kept fields are left out. */
export function entityForm(typeId, initial, { submitLabel, onSubmit, onCancel }) {
  const type = types.get(typeId);
  const state = { title: initial.title ?? '', status: initial.status ?? type.statuses.open[0], body: initial.body ?? '', visibility: initial.visibility ?? '', props: { ...(initial.props ?? {}) } };
  const bad = new Set();
  const error = h('div', { class: 'error', style: 'white-space: pre-wrap; padding: 0 var(--space-8) var(--space-8)' });

  const control = (key, def) => {
    const value = state.props[key];
    const set = (v) => {
      if (v === '' || v === undefined) delete state.props[key];
      else state.props[key] = v;
    };
    switch (def.type) {
      case 'enum':
        return h('select', { onchange: (e) => set(e.target.value) }, h('option', { value: '' }, '(not set)'), def.values.map((v) => h('option', { value: v, selected: v === value }, v)));
      case 'boolean':
        return h(
          'select',
          { onchange: (e) => set(e.target.value === '' ? '' : e.target.value === 'true') },
          [['', '(not set)'], ['true', 'yes'], ['false', 'no']].map(([v, label]) => h('option', { value: v, selected: String(value ?? '') === v }, label)),
        );
      case 'number':
        return h('input', { type: 'number', value: value ?? '', oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
      case 'date':
        return h('input', { type: 'date', value: value ?? '', oninput: (e) => set(e.target.value) });
      case 'json':
        return h('textarea', {
          rows: 4,
          value: value === undefined ? '' : JSON.stringify(value, null, 2),
          placeholder: '{ }',
          oninput: (e) => {
            bad.delete(key);
            if (!e.target.value.trim()) return set('');
            try {
              set(JSON.parse(e.target.value));
            } catch {
              bad.add(key);
            }
          },
        });
      default:
        return h('input', { type: 'text', value: value ?? '', placeholder: def.type === 'datetime' ? '2026-10-07T14:00:00Z' : '', oninput: (e) => set(e.target.value) });
    }
  };

  // What a field is for is its tooltip: a sentence under every box made the form a page of reading.
  const row = (name, input, hint) => [h('dt', { title: hint ?? '', class: hint ? 'hinted' : '' }, name), h('dd', {}, input)];
  const save = h('button', { class: 'primary' }, submitLabel);
  save.addEventListener('click', async () => {
    error.textContent = '';
    if (!state.title.trim()) return (error.textContent = 'A title is required.');
    if (bad.size) return (error.textContent = `Not valid JSON: ${[...bad].join(', ')}`);
    save.disabled = true;
    try {
      await onSubmit(state);
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });

  return h(
    'section',
    { class: 'card wide form' },
    h('header', {}, h('h2', {}, type.title), h('span', { class: 'n' }, type.description)),
    h(
      'dl',
      { class: 'fields' },
      row('Title', h('input', { type: 'text', value: state.title, oninput: (e) => (state.title = e.target.value) })),
      row('Status', h('select', { onchange: (e) => (state.status = e.target.value) }, statusesOf(typeId).map((s) => h('option', { value: s, selected: s === state.status }, s)))),
      Object.entries(type.fields)
        .filter(([, def]) => !def.system)
        .map(([key, def]) => row(label(key), control(key, def), def.description)),
      row('Notes', h('textarea', { rows: 5, value: state.body, oninput: (e) => (state.body = e.target.value) })),
      row(
        'Who can see it',
        h(
          'select',
          { onchange: (e) => (state.visibility = e.target.value) },
          !initial.id && h('option', { value: '' }, 'Workspace default'),
          [['private', 'Only me'], ['shared', 'Everyone in the workspace'], ...(initial.visibility === 'public' ? [['public', 'Anyone, with no login']] : [])].map(([v, label]) => h('option', { value: v, selected: v === state.visibility }, label)),
        ),
        'Only matters when several people share a workspace.',
      ),
    ),
    error,
    h('div', { class: 'actions' }, save, h('button', { onclick: onCancel }, 'Cancel')),
  );
}

export function newEntity(typeId) {
  const main = part('item');
  if (!types.has(typeId)) typeId = workType();
  const draw = () => {
    const form = entityForm(typeId, {}, {
      submitLabel: 'Create',
      onCancel: () => history.back(),
      onSubmit: async (next) => {
        const result = await api('change', { ops: [{ op: 'create', ref: 'new', type: typeId, title: next.title, status: next.status, body: next.body || undefined, visibility: next.visibility || undefined, props: next.props }], reason: 'Created in the UI' });
        location.hash = `#/e/${result.created.new}`;
      },
    });
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', {}, 'New')),
      h(
        'div',
        { class: 'toolbar', style: 'margin-bottom: var(--space-7)' },
        h('label', { class: 'muted' }, 'Type '),
        h(
          'select',
          {
            onchange: (e) => {
              typeId = e.target.value;
              draw();
            },
          },
          state.schema.types.filter((t) => !t.dormant).map((t) => h('option', { value: t.id, selected: t.id === typeId }, typeChoice(t))),
        ),
      ),
      h('div', { class: 'grid' }, form),
    );
  };
  draw();
}

/** What an automation does, in a line: when it fires and what it then does. */
export const automationDoes = (p) => {
  const when = p.trigger === 'every' ? `every ${p.every_minutes} min` : p.trigger === 'daily' ? `daily at ${p.at}` : `when ${p.on_action} is logged`;
  const what = p.action === 'notify' ? `notify: ${p.message ?? '(its title)'}` : p.action === 'tool' ? `call ${p.tool}` : `launch a session (${p.input?.mode ?? 'plan'}) on ${p.input?.task}`;
  return `${when} → ${what}`;
};
