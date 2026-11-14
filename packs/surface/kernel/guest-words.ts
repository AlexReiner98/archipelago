// What a guest map's agent reads at its link (./guest-route.ts), and the sentence the visitor pastes into it. The
// first item lands in seconds: the agent names the project first, from what it sees at a glance, then draws the plan
// to connect itself properly, made for whichever agent it is, and then waits (the owner, 13 Nov 2026, e_4hntjqsm).
// Plain lines and curl: an agent with a shell needs nothing installed to follow them.

/** The one sentence the visitor pastes into their agent. */
export const guestPrompt = (link: string) => `Read ${link} and do what it says: it puts this project on a map I can watch.`;

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
  '## What happens next',
  'Your agent puts your project on this map, then a plan to connect it properly. Each item appears here as it is written.',
  '',
  '## On a phone',
  '> [!NOTE]',
  '> A recording of an agent drawing a map comes here.',
  '',
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
  const post = `curl -s -X POST ${origin}/agent/change -H "authorization: Bearer ${key}" -H "content-type: application/json" -d '<the change, as JSON on one line>'`;
  return `Archipelago guest map ${workspace}: your user is watching it in their browser and sees each write the moment you send it. Nothing to install: every write is one POST of a change, and it applies at once. Be quick: they are waiting to see it.

Send each change as one command, the JSON in single quotes (in PowerShell, write the JSON to a file and send it with curl.exe and -d "@file.json"):
  ${post}

${install ? `The map already holds one item, ${install}: the note your user is reading, which gave them the sentence they pasted. Leave it as it is and write nothing like it; your project is tied to it below.\n\n` : ''}1. Now, before anything else: one item naming the project in your working folder. Run one command to look, \`ls; head -n 5 README* package.json\`, and nothing more; then send:
  {"reason":"The project","ops":[{"op":"create","ref":"p","type":"work","title":"<the project's name, a few words>","body":"<one sentence: what it is and what it is for>"}${install ? `,{"op":"link","type":"about","from":"${install}","to":"p"}` : ''}]}
The answer's result.created.p is its id.

2. Then the plan to connect you properly, beside it, as one change. Fill in which agent you are (Claude Code, Codex or Cursor) and the project's id. The steps follow your section of ${origin}/install.md; those only your user can do wait on them (${owner}, the person this map belongs to).
  {"reason":"Setup plan","ops":[
    {"op":"create","ref":"s1","type":"task","title":"Install Archipelago for <your agent>","body":"Run the installer from ${origin}/install.md for <your agent>."},
    {"op":"create","ref":"s2","type":"task","title":"Sign in to keep this map","body":"The browser opens to sign in; signing in connects <your agent> and saves this map."},
    {"op":"create","ref":"s3","type":"task","title":"Restart <your agent>","body":"Its Archipelago tools load with the next session."},
    {"op":"create","ref":"s4","type":"task","title":"Fill in the project","body":"Connected, <your agent> draws the rest of the project on the map."},
    {"op":"link","type":"part_of","from":"s1","to":"<project id>"},
    {"op":"link","type":"part_of","from":"s2","to":"<project id>"},
    {"op":"link","type":"part_of","from":"s3","to":"<project id>"},
    {"op":"link","type":"part_of","from":"s4","to":"<project id>"},
    {"op":"link","type":"depends_on","from":"s2","to":"s1"},
    {"op":"link","type":"depends_on","from":"s3","to":"s2"},
    {"op":"link","type":"depends_on","from":"s4","to":"s3"},
    {"op":"link","type":"waits_on","from":"s2","to":"${owner}","props":{"for":"sign in"}},
    {"op":"link","type":"waits_on","from":"s3","to":"${owner}","props":{"for":"restart"}}
  ]}

3. Then stop, and tell your user in two short lines: the project and its setup plan are on the map in their browser; when they want to keep it, say so and you will run step 1 of the plan (signing in saves the map, which is otherwise deleted in a week). Run nothing else until they answer.

If a change is refused, the answer says why in "error": fix that and send it again. The map is your user's to shape as they like (types, links, rules, views, styles, layouts: POST ${origin}/agent/query with {"name":"actions"} lists what each takes); only publishing and what reaches outside the map wait for them to sign in.
`;
}
