// The Workspace screen's cards: tokens, connecting an agent, importing, GitHub, the operator.

import { api, ask, h } from './base.js';
import { chip, hint, link, menu, when } from './words.js';

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
// A row of the Backups card.
function importRow(done) {
  const file = h('input', { type: 'file', accept: '.gz' });
  const result = h('div');
  const say = (cls, text) => result.replaceChildren(h('div', { class: cls, style: 'padding: 0 var(--space-8) var(--space-7)' }, text));
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
        `Relations: ${p.relations.added} added, ${p.relations.ended} ended. Activity: ${p.events.added} events. Proposals: ${p.proposals.added} added, ${p.proposals.decided} decided.`,
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
  return [h('div', { class: 'toolbar', style: 'padding: 0 var(--space-8) var(--space-7)' }, file, h('button', { onclick: start, title: 'Merge a map kept elsewhere into this one' }, 'Import\u2026')), result];
}

// GitHub tells this workspace when a repository is pushed to. The secret it
// signs with is made here and shown once, with where to put it.
export function githubCard() {
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading\u2026'));
  const draw = async (made) => {
    const s = made ?? (await api('github'));
    // The app, where the server can have one: repositories are chosen on GitHub and nothing is set up in them.
    const app = await api('github_app').catch(() => ({ available: false }));
    const go = (what) => () =>
      api('github_app', { [what]: true })
        .then((to) => (location.href = to.url))
        .catch(fail);
    const unhook = async () => {
      if (!(await ask({ title: 'Stop hearing from GitHub?', message: 'Pushes to the repositories chosen there no longer reach this map. The app stays installed on GitHub until it is removed there.', action: 'Disconnect', danger: true }))) return;
      api('github_app', { disconnect: true }).then(() => draw()).catch(fail);
    };
    // What reads the pushes: the agent on this server, once the workspace has given it a key to run on.
    const setKey = async () => {
      const key = await ask({ title: 'Anthropic key', message: 'The agent on this server reads each push against the map, and re-checks old items, on this key. It is kept on the server and never shown again.', input: { placeholder: 'sk-ant-\u2026', secret: true }, action: 'Save' });
      if (key) api('github_app', { key }).then(() => draw()).catch(fail);
    };
    const reading =
      app.available &&
      app.installation &&
      h(
        'div',
        { class: 'toolbar', style: 'padding: var(--space-6) var(--space-8) 0' },
        h('span', { class: `pill ${app.reader?.key ? 'ok' : 'warn'}`, title: app.reader?.key ? 'An agent on this server reads each push against the open work' : 'Pushes are recorded, but nothing reads them until there is a key' }, app.reader?.key ? 'pushes are read' : 'pushes are not read'),
        h('span', { class: 'grow muted small' }, app.reader?.key ? app.reader.model : ''),
        h('button', { class: app.reader?.key ? '' : 'primary', onclick: setKey }, app.reader?.key ? 'New key' : 'Set Anthropic key'),
        app.reader?.key && menu('More', [['Remove the key', () => api('github_app', { forget_key: true }).then(() => draw()).catch(fail), 'danger']]),
      );
    const appBar =
      app.available &&
      (app.installation
        ? h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8) 0' }, h('span', { class: 'pill ok' }, 'connected'), h('span', { class: 'grow' }, app.installation.account || app.app.name), h('button', { title: 'Choose on GitHub which repositories this map hears from', onclick: go('connect') }, 'Choose repositories'), menu('More', [!s.connected && ['Use a webhook as well', () => fresh()], ['Disconnect', unhook, 'danger']]))
        : app.app
          ? h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8) 0' }, h('span', { class: 'grow muted' }, app.app.name), h('button', { class: 'primary', title: 'Choose repositories on GitHub; each is put in the map and its pushes are heard', onclick: go('connect') }, 'Connect GitHub'), !s.connected && menu('More', [['Use a webhook instead', () => fresh()]]))
          : app.can_create && h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8) 0' }, h('span', { class: 'grow' }), h('button', { class: 'primary', title: 'Once for this server: GitHub asks for a name, and the server then has its app', onclick: go('create') }, 'Create the GitHub App'), !s.connected && menu('More', [['Use a webhook instead', () => fresh()]])));
    const url = location.origin + s.webhook_path;
    const fresh = async () => {
      if (s.connected && !(await ask({ title: 'Make a new secret?', message: 'The one GitHub has now stops working until you replace it in each repository\'s webhook.', action: 'New secret', danger: true }))) return;
      draw(await api('github', { new_secret: true })).catch(fail);
    };
    body.replaceChildren(
      appBar || '',
      reading || '',
      made?.secret
        ? h(
            'div',
            { style: 'padding: var(--space-7) var(--space-8) 0' },
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
      h(
        'ul',
        { class: 'rows' },
        s.repos.map((r) =>
          h(
            'li',
            { class: 'row-top' },
            h('span', { class: 'grow' }, link(r), r.github && [' ', h('span', { class: 'muted small' }, r.github)]),
            h('span', { class: 'muted small' }, !r.github ? 'no GitHub address' : r.last_push ? `pushed ${when(r.last_push.at)}` : 'no push heard yet'),
          ),
        ),
      ),
      (s.connected || !appBar) && h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, s.connected && h('code', { class: 'grow' }, url), h('button', { title: 'A webhook added by hand in each repository, signed with a secret made here', class: s.connected ? '' : 'primary', onclick: fresh }, s.connected ? 'New secret' : 'Connect GitHub')),
      appBar && !s.connected && h('div', { style: 'height: var(--space-7)' }),
    );
  };
  const fail = (err) => body.replaceChildren(h('div', { class: 'error' }, err.message));
  draw().catch(fail);
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Pushes keep the map current.' }, 'GitHub')), body);
}

// The operator runs the installation: they make workspaces and hand each its
// first sign-in token, and can read none of them. The secret is kept only in
// this page's memory, so it is asked for again after a reload.
export let operatorSecret = '';

export function operatorCard(current) {
  const body = h('div');
  const call = async (method, payload, path = '') => {
    const res = await fetch(`/operator/workspaces${path}`, {
      method,
      headers: { authorization: `Bearer ${operatorSecret}`, ...(payload && { 'content-type': 'application/json' }) },
      body: payload && JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json.result;
  };
  const draw = async (made) => {
    if (!operatorSecret) {
      const secret = h('input', { type: 'password', placeholder: 'Operator secret', autocomplete: 'off', style: 'flex: 1; min-width: var(--input-wide)' });
      const error = h('div');
      const open = async () => {
        operatorSecret = secret.value.trim();
        try {
          await draw();
        } catch (err) {
          operatorSecret = '';
          error.replaceChildren(h('div', { class: 'error' }, err.message));
        }
      };
      return body.replaceChildren(
        h('div', { class: 'empty' }, 'Needs the operator secret. ', hint('It was printed the first time the server started with tokens on. If it is lost, run "node src/cli.ts operator-reset" on the server.')),
        h('div', { class: 'toolbar', style: 'padding: 0 var(--space-8) var(--space-7)' }, secret, h('button', { onclick: open }, 'Show workspaces')),
        error,
      );
    }
    const list = await call('GET');
    const id = h('input', { type: 'text', placeholder: 'id, e.g. acme', style: 'flex: 1; min-width: var(--input-least)' });
    const name = h('input', { type: 'text', placeholder: 'Name', style: 'flex: 1; min-width: var(--input-least)' });
    const error = h('div');
    // With a backup file chosen, the new workspace starts as the map in that file.
    const file = h('input', { type: 'file', accept: '.gz', title: 'Optional: a backup file (.json.gz) to start the workspace from' });
    const create = async () => {
      try {
        const backup = file.files[0] && (await base64(file.files[0]));
        await draw(await call('POST', { id: id.value.trim(), name: name.value.trim(), ...(backup && { backup }) }));
      } catch (err) {
        error.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    };
    body.replaceChildren(
      made?.restored
        ? h('div', { class: 'muted small', style: 'padding: var(--space-7) var(--space-8) 0' }, `Restored ${made.restored.entities} entities and ${made.restored.events} events from the backup of "${made.restored.from.name}" taken ${new Date(made.restored.taken).toLocaleString()}. Tokens from where it came from do not work here.`)
        : '',
      made ? h('div', { style: 'padding: var(--space-7) var(--space-8) 0' }, secretBox(`Owner token for "${made.workspace.name}". Send it to its owner privately.`, made.owner_token)) : '',
      h(
        'ul',
        { class: 'rows' },
        list.map((w) =>
          h(
            'li',
            { class: 'row-top' },
            h('strong', {}, w.name),
            h('span', { class: 'grow muted' }, w.id),
            w.id === current && h('span', { class: 'pill ok' }, 'this one'),
            h(
              'button',
              {
                title: 'For an owner who has lost theirs',
                onclick: async () =>
                  (await ask({ title: `Issue a new owner token for "${w.name}"?`, message: 'It gives full control of that workspace. Tokens already issued keep working until its owner revokes them.', action: 'Issue token' })) &&
                  call('POST', {}, `/${encodeURIComponent(w.id)}/owner-token`)
                    .then((r) => draw(r))
                    .catch((err) => error.replaceChildren(h('div', { class: 'error' }, err.message))),
              },
              'New owner token',
            ),
          ),
        ),
      ),
      h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8) 0' }, id, name, h('button', { class: 'primary', onclick: create }, 'Create workspace'), h('button', { onclick: () => ((operatorSecret = ''), draw()) }, 'Forget secret')),
      h('label', { class: 'toolbar muted small', style: 'padding: var(--space-5) var(--space-8) var(--space-7)' }, 'From a backup file (optional):', file),
      error,
    );
  };
  draw().catch((err) => {
    operatorSecret = '';
    body.replaceChildren(h('div', { class: 'error' }, err.message));
  });
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Every workspace on this server. For whoever runs it.' }, 'Installation')), body);
}

// Whose workspace this is. "Needs you now" and the other standing questions
// are asked about the owner, so a new workspace is not much use until one is set.
export function ownerCard(owner, redraw) {
  const name = h('input', { type: 'text', placeholder: 'Your name', style: 'flex: 1; min-width: var(--input-least)' });
  const email = h('input', { type: 'text', placeholder: 'Email (optional)', style: 'flex: 1; min-width: var(--input-least)' });
  const error = h('div');
  const set = () =>
    name.value.trim() &&
    api('init', { name: name.value.trim(), email: email.value.trim() || undefined })
      .then(redraw)
      .catch((err) => error.replaceChildren(h('div', { class: 'error' }, err.message)));
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', {}, 'Owner')),
    owner
      ? h('ul', { class: 'rows' }, h('li', { class: 'row-top' }, chip('person'), h('span', { class: 'grow' }, link(owner))))
      : [h('div', { class: 'empty' }, 'No owner yet. ', hint('Enter your name to become it; a person is created for you in the map.')), h('div', { class: 'toolbar', style: 'padding: 0 var(--space-8) var(--space-7)' }, name, email, h('button', { class: 'primary', onclick: set }, 'Set owner')), error],
  );
}

/** The whole map as a file, for the owner to keep, whether agents may have one too, and a file brought in. */
export function backupCard(done) {
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
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'The whole map as one file: to keep, to restore into another server, or to merge in from elsewhere' }, 'Backups')),
    h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, h('button', { class: 'primary', onclick: download }, 'Download backup'), h('label', { title: 'Lets an agent call backup_download. A backup holds private items too.' }, allow, ' Agents may download'), note),
    importRow(done),
  );
}