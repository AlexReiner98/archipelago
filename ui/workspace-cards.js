// The Workspace screen's cards: tokens, connecting an agent, importing, GitHub's webhook, the operator.

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
  return [h('div', { class: 'toolbar', style: 'padding: 0 var(--space-8) var(--space-7)' }, file, h('button', { onclick: start, title: 'Merge a map kept elsewhere into this one' }, 'Import\u2026')), result];
}

// GitHub tells this workspace when a repository is pushed to: through the GitHub App (the Connections card), or a
// webhook added by hand, whose secret is made here and shown once, with where to put it.
export function githubCard() {
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading\u2026'));
  const draw = async (made) => {
    const s = made ?? (await api('github'));
    // What reads the pushes the GitHub App hands over: an agent on this server, on the workspace's model account (the Model card).
    const on = (await api('model_account').catch(() => ({}))).runs_on;
    const reading = h(
      'div',
      { class: 'toolbar', style: 'padding: var(--space-6) var(--space-8) 0' },
      h('span', { class: `pill ${on ? 'ok' : 'warn'}`, title: on ? 'An agent on this server reads each push the GitHub App hands over against the open work' : 'Pushes are recorded, but nothing reads them until a model account is connected, under Model' }, on ? 'pushes are read' : 'pushes are not read'),
      h('span', { class: 'grow' }),
    );
    const url = location.origin + s.webhook_path;
    const fresh = async () => {
      if (s.connected && !(await ask({ title: 'Make a new secret?', message: 'The one GitHub has now stops working until you replace it in each repository\'s webhook.', action: 'New secret', danger: true }))) return;
      draw(await api('github', { new_secret: true })).catch(fail);
    };
    // Through a div, so that a part left out (false) is skipped, not printed.
    body.replaceChildren(h('div', {},
      reading,
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
      h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, s.connected ? h('code', { class: 'grow' }, url) : h('span', { class: 'grow' }), h('button', { title: 'A webhook added by hand in each repository, signed with a secret made here: for a repository the GitHub App is not given', onclick: fresh }, s.connected ? 'New secret' : 'Use a webhook')),
    ));
  };
  const fail = (err) => body.replaceChildren(h('div', { class: 'error' }, err.message));
  draw().catch(fail);
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Pushes keep the map current.' }, 'GitHub')), body);
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

/** A box for one thing the owner lets agents do (a workspace setting), asked again before it is turned on. */
function allowance(key, question, note) {
  const allow = h('input', { type: 'checkbox', disabled: true });
  api('workspace_info').then((info) => ((allow.checked = info[key]), (allow.disabled = false)), () => null);
  allow.onchange = async () => {
    const on = allow.checked;
    if (on && !(await ask({ ...question, action: 'Allow', danger: true }))) return void (allow.checked = false);
    api('workspace_set', { [key]: on }).catch((err) => ((allow.checked = !on), (note.textContent = err.message)));
  };
  return allow;
}

/** Whether agents may publish this workspace's documents: the owner's to give and take back. */
export function publishCard() {
  const note = h('span', { class: 'muted small grow' });
  const allow = allowance('agent_publish', { title: 'Let agents publish?', message: 'An agent could then make a document public, for anyone to read, without asking you. Each publish is logged; taking one down stays yours.' }, note);
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'Who may make a document public at its own address' }, 'Publishing')),
    h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, h('label', { title: 'Lets an agent call publish and publish_all. Unpublishing stays a human’s.' }, allow, ' Agents may publish'), note),
  );
}

/** Whether agents may change the code drawings run without asking: it runs in the sandbox either way. */
export function codeCard() {
  const note = h('span', { class: 'muted small grow' });
  const allow = allowance('agent_code', { title: 'Let agents change drawings?', message: 'An agent could then change the code a view is drawn by, and it takes effect at once for whoever looks. It runs in the sandbox, reaching nothing of the page or the network; each change is logged and can be undone.' }, note);
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'Whether an agent’s change to a drawing’s code waits for you' }, 'Drawings')),
    h('div', { class: 'toolbar', style: 'padding: var(--space-7) var(--space-8)' }, h('label', { title: 'Lets an agent’s change to a style’s modules or code take effect without your approval.' }, allow, ' Agents may change drawings'), note),
  );
}

/** The whole map as a file, for the owner to keep, whether agents may have one too, and a file brought in. */
export function backupCard(done) {
  const note = h('span', { class: 'muted small grow' });
  const allow = allowance('agent_backups', { title: 'Let agents download backups?', message: 'A backup holds the whole map, private items included. An agent with your token could then read all of it.' }, note);
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

/** The server's packs, for an admin of the default workspace: each with what it may ask the server to do. Nothing when there are none. */
export function serverPacksCard() {
  const card = h('section', { class: 'card wide', hidden: true });
  api('server_packs').then(({ packs, refused }) => {
    if (!packs.length && !refused.length) return;
    const offers = (p) => [...p.pages.map((x) => `page ${x}`), ...p.entries.map((x) => `entry ${x}`), ...p.webhooks.map((x) => `webhook ${x}`)].join('\n');
    const row = (p) =>
      h(
        'li',
        { class: 'row-top tie-row' },
        h('span', { class: 'grow', title: `${p.title} ${p.version}, at /x/${p.id}\n${offers(p)}` }, h('strong', {}, p.title), ' ', h('span', { class: 'muted small' }, `/x/${p.id}`)),
        h('span', { class: 'pill', title: `What it may ask the server for:\n${p.acts.join('\n') || 'nothing'}` }, `${p.acts.length} act${p.acts.length === 1 ? '' : 's'}`),
      );
    const left = (r) => h('li', { class: 'row-top tie-row' }, h('span', { class: 'grow muted', title: `${r.folder}\n${r.why.join('\n')}` }, r.folder.split(/[\\/]/).pop()), h('span', { class: 'pill bad', title: r.why.join('\n') }, 'left out'));
    card.replaceChildren(h('header', {}, h('h2', { class: 'hinted', title: 'What this server does that no one workspace can, by packs kept on the machine it runs on' }, 'Server packs')), h('ul', { class: 'rows' }, packs.map(row), refused.map(left)));
    card.hidden = false;
  }, () => null);
  return card;
}
