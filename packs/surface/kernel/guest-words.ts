// What a guest map's agent reads at its link (./guest-route.ts), and the sentence the visitor pastes into it. The
// first item lands in seconds: the agent names the project first, from what it sees at a glance, then draws the
// project's work, its parts, what is under way and next and what waits on what, so the visitor sees their own work
// mapped before any account (the owner, 15 Nov 2026, e_4ktz366f). Saving the map, and connecting the agent properly,
// come after (steps 3 on: the sign-up session's).
// Plain lines and curl: an agent with a shell needs nothing installed to follow them.

/**
 * The one sentence the visitor pastes into their agent. It says what to map in the visitor's own words, so the agent
 * knows what is wanted and that its user asks it; the link only says how to write (e_68y53nch, e_pywj58bq).
 */
export const guestPrompt = (link: string) =>
  `Map this project's work on my Archipelago map: its main parts, what is under way and next, and what waits on what. How to write to it (plain curl, nothing to install): ${link}`;

/** The install note's title: the one item a guest map starts with, open in the visitor's tab (the owner, 14 Nov 2026). */
export const INSTALL_TITLE = 'Try it with your agent';

/**
 * The install note a guest map starts with, read in the visitor's tab as the map opens: the sentence to paste, with its
 * link, each in a block the page gives a Copy to (a Share on a phone), and what happens next. On a phone, where no
 * agent runs, the address to send to a computer. Placeholder words: the owner writes every public one.
 */
export const installNote = (prompt: string, origin: string) => [
  "Paste this into your agent (Claude Code, Codex or Cursor), in your project's folder:",
  '',
  '```',
  prompt,
  '```',
  '',
  '## What appears',
  'Your project, its main parts and its open work, drawn here as your agent writes them: about a minute.',
  '',
  '## On a phone',
  'No agent runs on a phone. Send this to your computer and open it there:',
  '',
  '```',
  `${origin}/#/try`,
  '```',
].join('\n');

/**
 * `owner`: the id of the person the map belongs to, whom the steps only they can do wait on; `install`: the install
 * note the map starts with, which the visitor is reading, if it has one.
 */
export function guestWords(origin: string, key: string, workspace: string, owner: string, install?: string): string {
  const post = `curl -s -X POST ${origin}/agent/change -H "authorization: Bearer ${key}" -H "content-type: application/json" -d @change.json`;
  return `Archipelago guest map ${workspace}. Your user asked you to map this project's work here: they are watching it in their browser and see each write the moment you send it. Nothing to install: every write is one POST of a change, and it applies at once. Be quick: they are waiting to see it.

Send each change by writing its JSON to a file, change.json, with your tool for writing files (not a shell heredoc, which agents' shells often refuse), then one command (curl.exe in PowerShell):
  ${post}

${install ? `The map already holds one item, ${install}: the note your user is reading, which gave them the sentence they pasted. Leave it as it is and write nothing like it; your project is tied to it below.\n\n` : ''}1. Now, before anything else: one item naming the project in your working folder. Run one command to look, \`ls; head -n 5 README* readme* package.json\`, and nothing more; then send:
  {"reason":"The project","ops":[{"op":"create","ref":"p","type":"work","title":"<the project's name, a few words>","body":"<one sentence: what it is and what it is for>"}${install ? `,{"op":"link","type":"about","from":"${install}","to":"p"}` : ''}]}
The answer's result.created.p is its id.

2. Then the project's work, as one change: this is what your user came to see. Look once more, in one command, at what shows where the work stands, such as \`git log --oneline -15; grep -rn "TODO\\|FIXME" --exclude-dir=node_modules --exclude-dir=.git . | head -15\` and the README's plans; read no further. Then send one change with:
  - 3 to 6 parts: the project's main areas (type work), each part_of the project.
  - 4 to 10 pieces of work (type task), each part_of its part: what recent commits finished (status done), what is under way (doing) and what is next (todo), each titled in a few words, with a one-sentence body saying where you saw it.
  - depends_on from a piece of work to what must come first, wherever one does.
  - 1 to 3 open questions (type question) where something is undecided; one only your user can answer waits on them (${owner}, the person this map belongs to): waits_on, with props.for saying what for.
  For example (refs are yours to choose; "<project id>" is result.created.p from step 1):
  {"reason":"The work","ops":[
    {"op":"create","ref":"a1","type":"work","title":"<a main area>"},
    {"op":"link","type":"part_of","from":"a1","to":"<project id>"},
    {"op":"create","ref":"t1","type":"task","title":"<a piece of work>","status":"doing","body":"<where you saw it>"},
    {"op":"link","type":"part_of","from":"t1","to":"a1"},
    {"op":"create","ref":"t2","type":"task","title":"<what comes after it>","status":"todo","body":"<where you saw it>"},
    {"op":"link","type":"part_of","from":"t2","to":"a1"},
    {"op":"link","type":"depends_on","from":"t2","to":"t1"},
    {"op":"create","ref":"q1","type":"question","title":"<something undecided>?","body":"<why it matters>"},
    {"op":"link","type":"part_of","from":"q1","to":"<project id>"},
    {"op":"link","type":"waits_on","from":"q1","to":"${owner}","props":{"for":"<what they decide>"}}
  ]}
  Say only what you saw; name things as the project does. Then go to step 3.

3. Then stop, and tell your user in two short lines, in these words or close to them: "Your project and its open work are on the map. Ask me to add more, or press Sign up at the top of the page to save it." Run nothing else until they answer. Asked for more, draw it as in step 2, tied to what is there.

4. Once they have signed up and ask you to connect properly: run the installer for your agent from ${origin}/install.md; its sign-in opens in the browser where they watch the map, and connects you to it. Ask them to restart you; connected, you keep the map current through your Archipelago tools.

If a change is refused, the answer says why in "error": fix that and send it again. The map is your user's to shape as they like (types, links, rules, views, styles, layouts: POST ${origin}/agent/query with {"name":"actions"} lists what each takes); only publishing and what reaches outside the map wait for them to sign in.
`;
}
