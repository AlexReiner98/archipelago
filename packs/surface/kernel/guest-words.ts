// What a guest map's agent reads at its link (./guest-route.ts), and the sentence the visitor pastes into it. The
// first item lands in seconds: the agent names the project first, from what it sees at a glance, then draws the plan
// to connect itself properly, made for whichever agent it is, and then waits (the owner, 13 Nov 2026, e_4hntjqsm).
// Plain lines and curl: an agent with a shell needs nothing installed to follow them.

/** The one sentence the visitor pastes into their agent. */
export const guestPrompt = (link: string) => `Read ${link} and do what it says: it puts this project on a map I can watch.`;

/** `owner`: the id of the person the map belongs to, whom the steps only they can do wait on. */
export function guestWords(origin: string, key: string, workspace: string, owner: string): string {
  const post = `curl -s -X POST ${origin}/agent/change -H "authorization: Bearer ${key}" -H "content-type: application/json" -d '<the change, as JSON on one line>'`;
  return `Archipelago guest map ${workspace}: your user is watching it in their browser and sees each write the moment you send it. Nothing to install: every write is one POST of a change, and it applies at once. Be quick: they are waiting to see it.

Send each change as one command, the JSON in single quotes (in PowerShell, write the JSON to a file and send it with curl.exe and -d "@file.json"):
  ${post}

1. Now, before anything else: one item naming the project in your working folder. Run one command to look, \`ls; head -n 5 README* package.json\`, and nothing more; then send:
  {"reason":"The project","ops":[{"op":"create","ref":"p","type":"work","title":"<the project's name, a few words>","body":"<one sentence: what it is and what it is for>"}]}
The answer's result.created.p is its id.

2. Then the plan to connect you properly, beside it, as one change. Fill in which agent you are (Claude Code, Codex or Cursor) and the project's id. The steps follow your section of ${origin}/install.md; those only your user can do wait on them (${owner}, the person this map belongs to).
  {"reason":"Setup plan","ops":[
    {"op":"create","ref":"s1","type":"task","title":"Install Archipelago for <your agent>","body":"Run the installer from ${origin}/install.md for <your agent>."},
    {"op":"create","ref":"s2","type":"task","title":"Sign in to keep this map","body":"The browser opens to sign in; signing in connects <your agent> and keeps this map. Done by itself when they sign in."},
    {"op":"create","ref":"s3","type":"task","title":"Restart <your agent>","body":"Its Archipelago tools load with the next session. Connected, <your agent> marks this done and takes away its wait, through those tools."},
    {"op":"create","ref":"s4","type":"task","title":"Fill in the project","body":"Connected, <your agent> draws the rest of the project on the map, then marks this done."},
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

4. When they say so: run the installer for your agent (step 1); its sign-in opens in the browser where they watch the map, and signing in there keeps it, starts their trial and connects you. Ask them to restart you, then, connected, tick the plan's steps through your Archipelago tools as its notes say.

If a change is refused, the answer says why in "error": fix that and send it again. The map is your user's to shape as they like (types, links, rules, views, styles, layouts: POST ${origin}/agent/query with {"name":"actions"} lists what each takes); only publishing and what reaches outside the map wait for them to sign in.
`;
}
