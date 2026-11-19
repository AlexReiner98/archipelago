// The settings a pack provides (setting.<key> in its manifest), one row each on its card: its name and a field that
// sets it here (workspace_set settings), on the person's authority. Unset, a setting reads as its pack's default,
// which the field shows greyed. Only an admin changes one; everyone sees it.

import { api, h, may, tell } from './base.js';
import { line } from './workspace-cards.js';

/** A setting's key as read in a row: its pack's prefix taken off, words for underscores. */
const named = (key, pack) => key.replace(new RegExp(`^${pack}_`), '').replace(/^reflex_/, '').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

/** One setting's field, by its shape: a number, a switch, or words. */
function field(def, value, done) {
  const set = (v) => api('workspace_set', { settings: { [def.key]: v } }).then(done, (err) => tell('That was not set', err.message));
  const off = !may('admin');
  if (def.shape === 'boolean') {
    const box = h('input', { type: 'checkbox', checked: value === true, disabled: off });
    box.onchange = () => set(box.checked);
    return box;
  }
  const number = def.shape === 'number';
  const input = h('input', { type: number ? 'number' : 'text', value: value == null ? '' : String(value), placeholder: def.default == null ? '' : String(def.default), disabled: off, ...(number && { style: 'width: var(--hours-field)' }) });
  input.onchange = () => set(input.value === '' ? null : number ? Number(input.value) : input.value);
  return input;
}

/** The rows of one pack's settings: info is workspace_info (its settings and setting_defs). */
export const settingRows = (info, pack, done) =>
  (info.setting_defs ?? [])
    .filter((d) => d.pack === pack)
    .map((d) => line(h('span', { class: 'grow', title: d.about ?? d.key }, h('strong', {}, named(d.key, pack)), ' ', h('span', { class: 'muted small' }, 'a setting')), field(d, info.settings?.[d.key], done)));
