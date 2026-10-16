// The Workspace screen's Backups card: the whole map as a file for the owner, and whether agents may have one too.
// The page's own helpers are handed in, so this module imports nothing.

export function backupCard({ h, api, ask }) {
  const note = h('span', { class: 'muted small grow' });
  const allow = h('input', { type: 'checkbox', disabled: true });
  api('workspace_info').then((info) => ((allow.checked = info.agent_backups), (allow.disabled = false)), () => null);
  allow.onchange = async () => {
    const on = allow.checked;
    if (on && !(await ask({ title: 'Let agents download backups?', message: 'A backup holds the whole map, private items included. An agent with your token could then read all of it.', action: 'Allow', danger: true }))) return void (allow.checked = false);
    api('workspace_set', { agent_backups: on }).catch((err) => ((allow.checked = !on), (note.textContent = err.message)));
  };
  const download = async (ev) => {
    ev.target.disabled = true;
    try {
      const made = await api('backup_download');
      location.href = made.path;
      note.textContent = `${Math.round(made.bytes / 1024)} KB, ${made.rows} rows`;
    } catch (err) {
      note.textContent = err.message;
    }
    ev.target.disabled = false;
  };
  return h(
    'section',
    { class: 'card' },
    h('header', {}, h('h2', { class: 'hinted', title: 'The whole map as one file: to keep, or to restore into another server' }, 'Backups')),
    h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: download }, 'Download backup'), note),
    h('div', { class: 'toolbar' }, h('label', { title: 'Lets an agent call backup_download. A backup holds private items too.' }, allow, ' Agents may download')),
  );
}