// The Workspace screen's cards for the workspace itself and what is outside it: the owner, connecting an agent, backups
// and importing, GitHub's webhook, the server's packs and the workspace's own settings. Each setting is one row.

import { api, ask, h } from './base.js';
import { hint, link, menu, when } from './words.js';

// ---- Workspace -----------------------------------------------------------

/** Show a new token's secret once, with a way to copy it. */
export function secretBox(label, token) {
  return h(
    'div',
    { class: 'secret' },
    h('div', {}, h('strong', {}, label)),
    h('code', {}, token),
    h('div', { class: 'toolbar' }, h('button', { onclick: (e) => navigator.clipboard.writeText(token).then(() => (e.target.textContent = 'Copied')) }, 'Copy'), h('span', { class: 'muted small' }, 'Shown once. It is not stored and cannot be shown again.')),
  );
}

// Connecting an agent is done once per machine: this server's address and the
// new token go into two environment variables, and every project whose
// .mcp.json reads them is connected. A setting kept inside Claude Code's own
// files can be overwritten by a running session; the machine's environment
// cannot.
export function connectBox(made) {
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
        h('strong', { class: 'grow' }, `Connect Claude Code as "${made.name}"`),
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
  const file = h('input', { type: 'file', accept: '.gz', hidden: true });
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
        return say('muted small', `Nothing to import: this map already has everything in the backup of "${p.from.name}" taken ${new Date(p.taken).toLocaleString()}.`);
      const message = [
        `From the backup of "${p.from.name}" taken ${new Date(p.taken).toLocaleString()}.`,
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

// GitHub tells this workspace when a repository is pushed to: through the GitHub App (its row above, on the same
// card), or a webhook added by hand, whose secret is made here and shown once, with where to put it. One row: whether
// pushes are read, the repositories and the latest push, each repository's in the tooltip; the webhook in its menu.
export function githubRow() {
  const row = line(h('span', { class: 'grow muted small' }, 'GitHub pushes…'));
  const shown = h('li', { class: 'pack-body', hidden: true });
  const fail = (err) => row.replaceChildren(h('span', { class: 'grow error', title: err.message }, err.message));
  const draw = async (made) => {
    const s = made ?? (await api('github'));
    // What reads the pushes the GitHub App hands over: an agent on this server, on the workspace's model account.
    const on = (await api('model_account').catch(() => ({}))).runs_on;
    const url = location.origin + s.webhook_path;
    const fresh = async () => {
      if (s.connected && !(await ask({ title: 'Make a new secret?', message: 'The one GitHub has now stops working until you replace it in each repository’s webhook.', action: 'New secret', danger: true }))) return;
      draw(await api('github', { new_secret: true })).catch(fail);
    };
    const heard = s.repos.filter((r) => r.last_push).sort((a, b) => (a.last_push.at < b.last_push.at ? 1 : -1));
    const repos = s.repos.map((r) => `${r.title}: ${!r.github ? 'no GitHub address' : r.last_push ? `pushed ${when(r.last_push.at)}` : 'no push heard yet'}`).join('\n');
    row.replaceChildren(
      h('span', { class: `pill ${on ? 'ok' : 'warn'}`, title: on ? 'An agent on this server reads each push against the open work' : 'Pushes are recorded, but nothing reads them until a model account is connected, under Agents' }, on ? 'read' : 'not read'),
      h('span', { class: 'grow', title: repos || 'No repository on the map yet' }, h('strong', {}, 'Pushes'), ' ', h('span', { class: 'muted small' }, `${s.repos.length} repositor${s.repos.length === 1 ? 'y' : 'ies'}`, heard[0] && ` · ${heard[0].title} pushed ${when(heard[0].last_push.at)}`)),
      menu('⋯', [[s.connected ? 'New webhook secret' : 'Use a webhook', fresh], s.connected && ['Copy the webhook address', () => navigator.clipboard.writeText(url)]]),
    );
    shown.hidden = !made?.secret;
    shown.replaceChildren(
      made?.secret
        ? h(
            'div',
            {},
            h(
              'div',
              { class: 'secret' },
              h('div', {}, h('strong', {}, 'Webhook secret')),
              h('code', {}, made.secret),
              h('div', { class: 'toolbar' }, h('button', { onclick: (e) => navigator.clipboard.writeText(made.secret).then(() => (e.target.textContent = 'Copied')) }, 'Copy'), h('span', { class: 'muted small' }, 'Shown once. If it is lost, make a new one.')),
            ),
            h('div', { class: 'muted small', style: 'margin-top: var(--space-5)' }, 'In each repository on GitHub: Settings, Webhooks, Add webhook. Payload URL: ', h('code', {}, url), '. Content type: application/json. Secret: the one above. Events: just the push event.'),
          )
        : '',
    );
  };
  draw().catch(fail);
  return [row, shown];
}

// Whose workspace this is. "Needs you now" and the other standing questions
// are asked about the owner, so a new workspace is not much use until one is set.
export function ownerRow(owner, redraw) {
  if (owner) return line(h('span', { class: 'grow' }, link(owner)));
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
  const allow = h('input', { type: 'checkbox', checked: Boolean(info[key]) });
  const name = h('span', { class: 'grow', title: tip }, label);
  allow.onchange = async () => {
    const on = allow.checked;
    if (on && !(await ask({ ...question, action: 'Allow', danger: true }))) return void (allow.checked = false);
    api('workspace_set', { [key]: on }).catch((err) => ((allow.checked = !on), (name.title = err.message)));
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
    h('select', { onchange: (e) => api('workspace_set', { default_visibility: e.target.value }).then(redraw, fail) }, [['private', 'Private unless shared'], ['shared', 'Shared unless private']].map(([v, label]) => h('option', { value: v, selected: v === info.default_visibility }, label))),
  );
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
    menu('⋯', [['Change…', accept]]),
  );
}

/** The server's packs, for an admin of the default workspace: each with what it may ask the server to do. Nothing when there are none. */
export function serverPacksCard() {
  const box = card('Server packs', 'What this server does that no one workspace can, by packs kept on the machine it runs on');
  box.hidden = true;
  api('server_packs').then(({ packs, refused }) => {
    if (!packs.length && !refused.length) return;
    const offers = (p) => [...p.pages.map((x) => `page ${x}`), ...p.entries.map((x) => `entry ${x}`), ...p.webhooks.map((x) => `webhook ${x}`)].join('\n');
    const row = (p) =>
      line(
        h('span', { class: 'grow', title: `${p.title} ${p.version}, at /x/${p.id}\n${offers(p)}` }, h('strong', {}, p.title), ' ', h('span', { class: 'muted small' }, `/x/${p.id}`)),
        h('span', { class: 'pill', title: `What it may ask the server for:\n${p.acts.join('\n') || 'nothing'}` }, `${p.acts.length} act${p.acts.length === 1 ? '' : 's'}`),
      );
    const left = (r) => line(h('span', { class: 'grow muted', title: `${r.folder}\n${r.why.join('\n')}` }, r.folder.split(/[\\/]/).pop()), h('span', { class: 'pill bad', title: r.why.join('\n') }, 'left out'));
    box.append(h('ul', { class: 'rows' }, packs.map(row), refused.map(left)));
    box.hidden = false;
  }, () => null);
  return box;
}
