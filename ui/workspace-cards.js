// The Workspace screen's cards for the workspace itself and what is outside it: the owner, connecting an agent, backups
// and importing, GitHub's webhook, the server's packs and the workspace's own settings. Each setting is one row.

import { api, ask, drawingsChanged, h, may, state } from './base.js';
import { hint, link, menu } from './words.js';
import { plate, plates } from './plates.js';

// ---- Workspace -----------------------------------------------------------

/** Show a new token's secret once, with a way to copy it, and for a token, the workspace it acts in. */
export function secretBox(label, token, workspace) {
  return h(
    'div',
    { class: 'secret' },
    h('div', { class: 'gist', title: workspace ? `It acts in the workspace ${workspace.name} (${workspace.id}) alone` : label }, h('strong', {}, label)),
    h('code', {}, token),
    h('div', { class: 'toolbar' }, h('button', { onclick: (e) => navigator.clipboard.writeText(token).then(() => (e.target.textContent = 'Copied')) }, 'Copy'), h('span', { class: 'muted small' }, 'Shown once. It is not stored and cannot be shown again.')),
  );
}

// Connecting an agent is done once per machine: this server's address and the
// new token go into two environment variables, and every project whose
// .mcp.json reads them is connected. A setting kept inside Claude Code's own
// files can be overwritten by a running session; the machine's environment
// cannot.
export function connectBox(made, workspace = state.workspace) {
  // One command, copied and run in the project's folder on the machine the agent will work on. It carries the
  // address and the token in, the setup script keeps them for that machine, and the same script sets the project up.
  // The same command the server gives a session whose project is behind (setupCommand in src/connect.ts).
  const fetchIt = `node -e "fetch('${location.origin}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"`;
  const first = {
    windows: `$env:PELAGO_URL='${location.origin}'; $env:PELAGO_AGENT_TOKEN='${made.token}'; $env:PELAGO_SETUP_SAVE='1'; ${fetchIt}`,
    unix: `PELAGO_URL='${location.origin}' PELAGO_AGENT_TOKEN='${made.token}' PELAGO_SETUP_SAVE=1 ${fetchIt}`,
  };
  const copy = (text, label) => h('button', { class: 'primary', onclick: (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = 'Copied')) }, label);
  const box = h('div', { class: 'secret' });
  const draw = (os) =>
    box.replaceChildren(
      h(
        'div',
        { class: 'toolbar' },
        h('strong', { class: 'grow gist', title: made.everywhere ? `The token acts as you in every workspace you are a member of; a call names its workspace, else it acts in ${made.home}` : workspace && `The token acts in the workspace ${workspace.name} (${workspace.id}) alone` }, `Connect Claude Code as "${made.name}"${made.everywhere ? ' to all your workspaces' : workspace ? ` to ${workspace.name}` : ''}`),
        h('span', { class: 'switch', title: 'The machine the agent will work on' }, [['windows', 'Windows'], ['unix', 'Mac or Linux']].map(([key, label]) => h('button', { class: os === key ? 'on' : '', onclick: () => draw(key) }, label))),
      ),
      h('div', { class: 'muted small' }, `1. On that machine, in ${os === 'windows' ? 'PowerShell' : 'a terminal'}, in the project's folder. Then quit Claude Code completely and open it in that folder.`),
      h('code', { style: 'white-space: pre-wrap; word-break: break-all' }, first[os].replace(made.token, `${made.token.slice(0, 12)}…`)),
      h('div', { class: 'toolbar' }, copy(first[os], 'Copy command'), h('span', { class: 'muted small' }, 'Shown once: it holds the token. Revoke it below to disconnect.')),
      h('div', { class: 'muted small', style: 'margin-top: var(--space-6)' }, '2. For each other project on that machine, in its folder. It holds no secret.'),
      h('code', { style: 'white-space: pre-wrap; word-break: break-all' }, fetchIt),
      h(
        'div',
        { class: 'toolbar' },
        copy(fetchIt, 'Copy command'),
        // The command fetches a script and runs it: it shows what it will change and asks first. These are the ways
        // to look before that, and to take it out again.
        h('a', { href: '/connect/setup.mjs', target: '_blank', title: 'The script the command fetches and runs. It shows what it will change and asks before it writes.' }, 'Read it first'),
        menu('More', [
          ['Copy the dry run', () => navigator.clipboard.writeText(`${fetchIt} -- --dry-run`)],
          ['Copy the removal', () => navigator.clipboard.writeText(`${fetchIt} -- --remove`)],
        ]),
      ),
    );
  draw(/win/i.test(navigator.platform) ? 'windows' : 'unix');
  return box;
}

/** A chosen file's bytes in base64, which is how a backup file is sent. */
export const base64 = (blob) =>
  new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => fail(new Error('That file could not be read.'));
    reader.readAsDataURL(blob);
  });

// Bring a map kept somewhere else into this one, as often as wanted: the
// server says what the file would add and change, and does it only on a yes.
// Opened from the Backups row's menu: choosing the file starts it.
function importer(done) {
  const file = fileInput('.gz');
  const result = h('div');
  const say = (cls, text) => result.replaceChildren(h('div', { class: `${cls} gist`, style: 'padding: var(--space-4) 0', title: text }, text));
  const list = (titles, n) => (titles.length ? `: ${titles.slice(0, 5).join(', ')}${n > 5 ? ', \u2026' : ''}` : '');
  const start = async () => {
    try {
      if (!file.files[0]) return say('error', 'Choose a backup file first.');
      const backup = await base64(file.files[0]);
      const p = await api('import_backup', { backup });
      const e = p.entities;
      // The file's owner may be this workspace's owner under another id.
      const same_owner =
        Boolean(p.owners) &&
        Boolean(
          await ask({
            title: `Is "${p.owners.file.title}" you?`,
            message: `The backup belongs to "${p.owners.file.title}". This workspace belongs to "${p.owners.here.title}". If they are one person, "${p.owners.here.title}" becomes "${p.owners.file.title}" here, keeping every token and everything private, and later imports of the same map line up.`,
            action: 'Yes, one person',
            cancel: 'No, keep both',
          }),
        );
      const nothing = !e.added && !e.updated && !p.relations.added && !p.relations.ended && !p.events.added && !p.proposals.added && !p.proposals.decided && !p.types_added.length;
      if (nothing && same_owner) {
        await api('import_backup', { backup, apply: true, same_owner });
        file.value = '';
        say('muted small', `"${p.owners.here.title}" and "${p.owners.file.title}" are now one person. Nothing else in the backup was new.`);
        return done?.();
      }
      if (nothing)
        return say('muted small', `Nothing to import: this map already has everything in the backup of "${p.from.name}" taken ${when(p.taken)}.`);
      const message = [
        `From the backup of "${p.from.name}" taken ${when(p.taken)}.`,
        `Added: ${e.added}${list(p.examples.added, e.added)}`,
        `Replaced by the file's later edit: ${e.updated}${list(p.examples.updated, e.updated)}`,
        `Kept, because edited later here: ${e.kept_newer_here}${list(p.examples.kept_newer_here, e.kept_newer_here)}`,
        `Links: ${p.relations.added} added, ${p.relations.ended} ended. Activity: ${p.events.added} events. Proposals: ${p.proposals.added} added, ${p.proposals.decided} decided.`,
        p.types_added.length ? `Types added: ${p.types_added.join(', ')}` : '',
        p.left_out.open_sessions ? `Left out: ${p.left_out.open_sessions} sessions still open there.` : '',
        'Nothing is deleted. The server backs this map up first.',
      ]
        .filter(Boolean)
        .join('\n');
      if (!(await ask({ title: 'Merge this backup into the map?', message, action: 'Merge' }))) return;
      const r = await api('import_backup', { backup, apply: true, same_owner });
      file.value = '';
      say('muted small', `Merged: ${r.entities.added} added, ${r.entities.updated} replaced, ${r.entities.kept_newer_here} kept as they are here, ${r.events.added} events.${r.backed_up_first ? '' : ' Backups are off on this server, so none was taken first.'}`);
      done?.();
    } catch (err) {
      say('error', err.message);
    }
  };
  file.onchange = () => file.files[0] && start();
  return { file, result, open: () => ((file.value = ''), file.click()) };
}

/** A card of one-line rows under a short title, its explanation in the title's tooltip. */
export const card = (title, tip, ...body) => h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: tip ? 'hinted' : '', title: tip ?? '' }, title)), ...body);
/** A row that never wraps: what does not fit is cut, the whole of it in the tooltip. */
export const line = (...kids) => h('li', { class: 'one' }, ...kids);
/** A hidden chooser of a backup file, opened by a menu's entry. */
export const fileInput = (accept) => h('input', { type: 'file', accept, hidden: true });

// Whose workspace this is. "Needs you now" and the other standing questions
// are asked about the owner, so a new workspace is not much use until one is set.
export function ownerRow(owner, redraw) {
  if (owner || !may('write')) return line(h('span', { class: 'grow' }, owner ? link(owner) : '—'));
  const name = h('input', { type: 'text', placeholder: 'Your name', style: 'flex: 1; min-width: 0' });
  const email = h('input', { type: 'text', placeholder: 'Email (optional)', style: 'flex: 1; min-width: 0' });
  const set = () =>
    name.value.trim() &&
    api('init', { name: name.value.trim(), email: email.value.trim() || undefined })
      .then(redraw)
      .catch((err) => (name.title = err.message));
  return line(hint('Enter your name to become it; a person is made for you on the map.'), name, email, h('button', { class: 'primary', onclick: set }, 'Set owner'));
}

/** A switch for one thing the owner lets agents do (a workspace setting), asked again before it is turned on. */
export function allowance(info, key, label, tip, question) {
  const allow = h('input', { type: 'checkbox', checked: Boolean(info[key]), disabled: !may('admin') });
  const name = h('span', { class: 'grow', title: tip }, label);
  allow.onchange = async () => {
    const on = allow.checked;
    if (on && !(await ask({ ...question, action: 'Allow', danger: true }))) return void (allow.checked = false);
    api('workspace_set', { [key]: on }).then(drawingsChanged, (err) => ((allow.checked = !on), (name.title = err.message)));
  };
  return line(name, allow);
}

/** The whole map as a file, for the owner to keep, and a map kept elsewhere merged in, rarely: one row, under the rows given. */
export function backupCard(done, ...before) {
  const note = h('span', { class: 'muted small' }, 'the whole map, as one file');
  const download = async (ev) => {
    ev.target.disabled = true;
    try {
      const made = await api('backup_download');
      location.href = made.path;
      note.textContent = `${Math.round(made.bytes / 1024)} KB, ${made.rows} rows`;
    } catch (err) {
      note.textContent = err.message;
      note.title = err.message;
    }
    ev.target.disabled = false;
  };
  if (!may('admin')) return card('Settings', null, h('ul', { class: 'rows' }, before));
  const merge = importer(done);
  return card(
    'Settings',
    null,
    h('ul', { class: 'rows' }, before, line(h('span', { class: 'grow', title: 'The whole map as one file: to keep, to restore into another server, or to merge in from elsewhere' }, h('strong', {}, 'Backup'), ' ', note), h('button', { onclick: download }, 'Download'), menu('⋯', [['Import a backup…', merge.open]]))),
    merge.file,
    merge.result,
  );
}

/** Whether new things start private or shared: a row of the Map section. */
export function visibilityRow(info, redraw, fail) {
  return line(
    h('span', { class: 'grow', title: 'Who sees what is made here, unless its author says otherwise' }, 'New things are'),
    h('select', { disabled: !may('admin'), onchange: (e) => api('workspace_set', { default_visibility: e.target.value }).then(redraw, fail) }, [['private', 'Private unless shared'], ['shared', 'Shared unless private']].map(([v, label]) => h('option', { value: v, selected: v === info.default_visibility }, label))),
  );
}

/**
 * Whether the packs here are held to the island rules (workspace_set islands): a row of the Map section. A new map
 * starts with it on; turned on for a map with work, what is on no island moves onto islands (src/island-start.ts).
 */
export function islandsRow(info, redraw, fail) {
  if (!may('admin')) return null;
  const on = h('input', { type: 'checkbox', checked: Boolean(info.islands) });
  const name = h('span', { class: 'grow', title: 'Each pack is an island: it is taken only if its file holds its vocabulary, views and instructions and it builds on the shared set alone, and every item lives on one island. Islands meet only through findings.' }, 'Islands');
  on.onchange = async () => {
    const want = on.checked;
    const message = info.started ? 'What is on the map moves onto an island for each pack it speaks, in one change you can undo. Packs that do not keep the rules are turned off; if one is in use, nothing changes.' : 'Packs that do not keep to them are turned off, and every item made from now on lives on an island.';
    if (want && !(await ask({ title: 'Hold this map to the island rules?', message, action: 'Turn on' }))) return void (on.checked = false);
    api('workspace_set', { islands: want }).then(redraw, (err) => ((on.checked = !want), (name.title = err.message), fail(err)));
  };
  return line(name, on);
}

/** Which other workspaces on this server may notify this one: a row of the Connections card, changed in its menu. */
export function notificationsRow(info, redraw, fail) {
  const from = info.accepts_from.join(', ');
  const accept = async () => {
    const said = await ask({ title: 'Accept notifications from', message: `Other workspaces on this server, by id, separated by commas. Now: ${from || 'none'}. This one is "${info.id}".`, input: { placeholder: from || 'workspace ids' }, action: 'Save' });
    if (said != null) api('workspace_set', { accepts_from: said.split(',').map((s) => s.trim()).filter(Boolean) }).then(redraw, fail);
  };
  return line(
    h('span', { class: 'grow', title: `Other workspaces on this server that may send this one notifications. This workspace's id is "${info.id}".` }, h('strong', {}, 'Other workspaces'), ' ', h('span', { class: 'muted small' }, from ? `notify it: ${from}` : 'none may notify it')),
    may('admin') ? menu('⋯', [['Change…', accept]]) : h('span', { class: 'menu-room' }),
  );
}

/** The server's packs, for an admin of the default workspace: each a plate, with what it offers and may ask the server to do. Nothing when there are none. */
export function serverPacksCard() {
  const box = card('Server packs', 'What this server does that no one workspace can, by packs kept on the machine it runs on');
  box.hidden = true;
  api('server_packs').then(({ packs, refused }) => {
    if (!packs.length && !refused.length) return;
    const offers = (p) => [...p.pages.map((x) => `page ${x}`), ...p.entries.map((x) => `entry ${x}`), ...p.webhooks.map((x) => `webhook ${x}`)];
    const served = (p) =>
      plate({
        name: p.title,
        title: `${p.title} ${p.version}, at /x/${p.id}`,
        marks: [h('span', { class: 'muted small' }, p.version), h('span', { class: 'mark', title: `What it may ask the server for:\n${p.acts.join('\n') || 'nothing'}` }, `${p.acts.length} act${p.acts.length === 1 ? '' : 's'}`)],
        says: `At /x/${p.id}`,
        foot: offers(p).length > 0 && { text: offers(p).join(' · '), title: offers(p).join('\n') },
      });
    const left = (r) => plate({ name: r.folder.split(/[\\/]/).pop(), title: r.folder, off: true, marks: h('span', { class: 'mark bad', title: r.why.join('\n') }, 'left out'), says: r.why.join(' · ') });
    box.append(plates(packs.map(served), refused.map(left)));
    box.hidden = false;
  }, () => null);
  return box;
}
