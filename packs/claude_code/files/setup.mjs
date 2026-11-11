// Made by packs/claude_code/sync.mjs from scripts/pelago-setup.mjs and the files it writes: do not change it here.
const ORIGIN = {origin};
const TOKENS = {tokens};
const VERSION = {version};
// Away from this repository the hook has no local server to fall back on: it calls the one that handed it out.
const HANDED_HOOK = "// A Claude Code hook that tells Archipelago about the session: started, a prompt\n// sent, ended. Claude Code hands the hook its input as JSON on stdin and\n// reads the answer from stdout; this passes both through to the Archipelago\n// server the machine is connected to (PELAGO_URL and PELAGO_AGENT_TOKEN,\n// the same two that .mcp.json reads), or to the one on this machine when\n// those are not set.\n//\n//   node scripts/pelago-hook.mjs session-start | prompt | stop | session-end | file-used\n//\n// At the start it also says which repository the folder is a checkout of (its\n// origin), so the map knows the session's repository on any machine.\n//\n// With each prompt, at the end of each turn (stop) and at the end it also says how many tokens the session\n// has used so far, counted from the session's own record on this machine\n// (the transcript Claude Code names in the hook's input): input and output,\n// not counting cached re-reads. Archipelago gives what is new to the work the\n// session is on. From the same record it says which items the session's calls\n// to the map named (read, shown or changed), so the session's end asks about\n// what it touched: the server cannot tell apart sessions that share a token.\n// And what Claude Code calls the session (its title: the one the owner gave it, else the one Claude Code made), which\n// the map calls the session by and its tab on the owner's page shows, at the start (on a resume) and at every event.\n// And what the reply did since the owner's last message (the turn): how many times it read the map (and of those,\n// surveyed it: read about several items), showed the owner something, changed the map, told a beat of its story, called\n// any other tool (worked), edited a file, committed and pushed, so that a rule on a reply's end can ask the agent to go on.\n// And the commits the session made, by their full ids (what git answered each commit with, looked up in the\n// checkout, and what the checkout's HEAD log records while each commit command ran, for one that answered nothing),\n// with those the reply made or, when it pushed, all of them: the map asks about those it does not account for.\n//\n// It also keeps the run the session is registered as (the server says it beside its answer to session-start) in\n// the checkout's git folder, one file per session (pelago-runs/<session id>), and takes it out at the end. The\n// commit-msg hook the setup installs reads it by the session id Claude Code gives every command it runs\n// (CLAUDE_CODE_SESSION_ID), so a commit made in the session names its run, and one made by anybody else does not:\n// several sessions in one checkout each find their own.\n//\n// Beside it, the process of the Claude Code that runs the session (CLAUDE_PID, pelago-runs/<session id>.pid). A chat\n// archived or closed may be stopped before its SessionEnd hook is heard: the next hook in the checkout finds its\n// process gone and ends its run for it.\n//\n// After a file is read or changed (file-used) it sends the file's path alone, never what is in it, and the\n// instructions the session has been told about files already, kept beside its run (pelago-runs/<session id>.said):\n// the server answers what bites in that file, said once a session.\n//\n// At the end of each turn and at the end it also says where the checkout stands (branch, commit, folder, commits no\n// remote has, files not committed), which the run keeps, so what a session left unpushed is known after it ends.\n//\n// It never fails the session: if the server is away or refuses it, it says so in the session once (a message the\n// person sees) and answers nothing more. With no token set, a server that asks for one is signed in to through the\n// browser (pelago-login.mjs, beside this in the plugin): the session that asked is registered at its first prompt\n// after. Run by the plugin (--plugin), the working rules beside it (../pelago.md) are said at the start, since a\n// plugin cannot add to CLAUDE.md.\n\nimport { execFileSync } from 'node:child_process';\nimport { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { dirname, resolve } from 'node:path';\n\n// Which hand-out of Archipelago's files this project has: the setup writes it in, and the server says when it is behind.\nconst SETUP = '';\n\nconst name = process.argv[2];\nconst base = (process.env.PELAGO_URL || 'http://127.0.0.1:3100').replace(/\\/$/, '');\nconst login = await import('./pelago-login.mjs').catch(() => null);\nlet token = process.env.PELAGO_AGENT_TOKEN || (await login?.accessToken(base).catch(() => undefined));\n\nlet input = '';\nfor await (const chunk of process.stdin) input += chunk;\n\n// The map's tools, as the setup names their server (pelago), and an item's id. A session may be\n// connected to other workspaces too, each its own server named after this one (pelago-site): what the reply read,\n// changed or told there counts for what it did, while the items it named there are not this map's to ask about.\n// Installed as a plugin, Claude Code names them mcp__plugin_<plugin>_pelago__<tool>.\nconst MAP_TOOL = /^mcp__(plugin_[\\w-]+?_)?pelago__/;\nconst ANY_MAP_TOOL = /^mcp__(plugin_[\\w-]+?_)?pelago([-_][\\w-]*?)?__/;\nconst ITEM = /\\be_[a-z0-9]{8}\\b/g;\n// A git command, past the options that come before its subcommand (git -C dir commit, git -c a=b push).\nconst GIT = (sub) => new RegExp(String.raw`(^|[\\s;&|(])git(\\s+(-[Cc]\\s+(\"[^\"]*\"|'[^']*'|\\S+)|--?[\\w-]+(=\\S+)?))*\\s+` + sub + String.raw`(?![\\w-])`);\nconst COMMIT = GIT('commit');\nconst PUSH = GIT('push');\n// The reads that are not about several items: one item, what the tools take, where a session starts, how a page looks.\nconst NOT_SURVEYS = new Set(['get', 'document', 'actions', 'schema', 'watch', 'picture', 'packs', 'style', 'story', 'published', 'publish_plan', 'backup_download', 'share_figure', 'brief', 'handoff', 'frontier']);\n// The tools that write a file.\nconst EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);\n// What git answers a commit with: [branch 1a2b3c4] Subject, or [main (root-commit) 1a2b3c4], or [detached HEAD 1a2b3c4].\nconst MADE = /^\\[[^\\]\\n]*? ([0-9a-f]{7,40})\\] /gm;\nconst textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('\\n') : '');\n\n/** Whether a transcript entry is a message the owner wrote: not a tool's answer, nor what Claude Code put in. */\nconst prompted = (entry) =>\n  entry.type === 'user' &&\n  !entry.isMeta &&\n  !entry.isCompactSummary &&\n  (typeof entry.message?.content === 'string' ||\n    (Array.isArray(entry.message?.content) && entry.message.content.some((p) => p.type === 'text') && !entry.message.content.some((p) => p.type === 'tool_result')));\n\n/**\n * From a transcript: the tokens used so far, each answer counted once however many lines it was written as, and the\n * items the session's calls to the map named, in what it sent and in what a change answered (the items it made).\n */\nfunction readTranscript(text) {\n  const answers = new Map();\n  const touched = new Set();\n  const changes = new Set();\n  const committing = new Set();\n  const made = [];\n  let turnMade = [];\n  // When each commit command ran, and in which turn, to find in the HEAD log what it made.\n  const running = new Map();\n  let turns = 0;\n  let turn;\n  let title;\n  let made_title;\n  let reply = {};\n  const named = (said) => {\n    for (const id of JSON.stringify(said ?? '').match(ITEM) ?? []) touched.add(id);\n  };\n  for (const line of text.split('\\n')) {\n    const calls = line.includes('\"mcp__pelago');\n    const answered = (changes.size > 0 || committing.size > 0) && line.includes('\"tool_result\"');\n    const asked = line.includes('\"user\"') && !line.includes('\"tool_result\"');\n    if (line.includes('\"custom-title\"') || line.includes('\"ai-title\"')) {\n      try {\n        const said = JSON.parse(line);\n        if (said.type === 'custom-title') title = said.customTitle ?? title;\n        else if (said.type === 'ai-title') made_title = said.aiTitle ?? said.title ?? made_title;\n      } catch {\n        // A line that is not whole yet: the next count has it.\n      }\n    }\n    if (!line.includes('\"usage\"') && !line.includes('\"tool_use\"') && !calls && !answered && !asked && !line.includes('\"Bash\"') && !/\"(Edit|Write|MultiEdit|NotebookEdit)\"/.test(line)) continue;\n    try {\n      const entry = JSON.parse(line);\n      if (prompted(entry)) {\n        turn = entry.uuid;\n        reply = { read: 0, surveyed: 0, showed: 0, changed: 0, told: 0, worked: 0, edited: 0, committed: 0, pushed: 0 };\n        turnMade = [];\n        turns++;\n      }\n      const usage = entry.message?.usage;\n      if (entry.type === 'assistant' && usage) answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));\n      for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {\n        if (part.type === 'tool_use' && MAP_TOOL.test(part.name ?? '')) {\n          named(part.input);\n          if (part.name.endsWith('__change')) changes.add(part.id);\n        }\n        if (part.type === 'tool_use' && ANY_MAP_TOOL.test(part.name ?? '')) {\n          const told = part.name.endsWith('__report') && part.input?.action;\n          const did = part.name.endsWith('__query') ? 'read' : part.name.endsWith('__change') ? 'changed' : told === 'show' ? 'showed' : told === 'tell' ? 'told' : undefined;\n          if (did) reply[did] = (reply[did] ?? 0) + 1;\n          if (did === 'read' && typeof part.input?.name === 'string' && !NOT_SURVEYS.has(part.input.name)) reply.surveyed = (reply.surveyed ?? 0) + 1;\n        }\n        if (part.type === 'tool_use' && !ANY_MAP_TOOL.test(part.name ?? '')) reply.worked = (reply.worked ?? 0) + 1;\n        if (part.type === 'tool_use' && EDITS.has(part.name)) reply.edited = (reply.edited ?? 0) + 1;\n        if (part.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string') {\n          if (COMMIT.test(part.input.command)) (reply.committed = (reply.committed ?? 0) + 1), committing.add(part.id), running.set(part.id, { from: Date.parse(entry.timestamp), turn: turns });\n          if (PUSH.test(part.input.command)) reply.pushed = (reply.pushed ?? 0) + 1;\n        }\n        if (part.type === 'tool_result' && changes.has(part.tool_use_id)) named(part.content);\n        if (part.type === 'tool_result' && running.has(part.tool_use_id)) running.get(part.tool_use_id).to = Date.parse(entry.timestamp);\n        if (part.type === 'tool_result' && committing.has(part.tool_use_id))\n          for (const [, sha] of textOf(part.content).matchAll(MADE)) made.push(sha), turnMade.push(sha);\n      }\n    } catch {\n      // A line that is not whole yet: the next count has it.\n    }\n  }\n  let tokens = 0;\n  for (const n of answers.values()) tokens += n;\n  const ran = [...running.values()].map((r) => ({ ...r, mine: Boolean(turn) && r.turn === turns }));\n  const called = title ?? made_title;\n  return { tokens, touched: [...touched], made, ran, ...(called && { title: called }), ...(turn && { turn, reply, turnMade }) };\n}\n\n/** Commits by their full ids, looked up in the checkout: what it does not hold (gone, or another folder's) is left out. */\nfunction fullIds(cwd, shorts) {\n  if (!shorts.length) return [];\n  try {\n    const out = execFileSync('git', ['-C', cwd || '.', 'cat-file', '--batch-check'], { input: shorts.map((s) => `${s}^{commit}`).join('\\n') + '\\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });\n    return [...new Set(out.split('\\n').flatMap((l) => /^([0-9a-f]{40}) commit /.exec(l)?.slice(1) ?? []))];\n  } catch {\n    return [];\n  }\n}\n\n/** The commits the checkout's HEAD log records while the session's commit commands ran (a second's slack), and whether the reply's. */\nfunction logged(cwd, ran) {\n  const times = ran.filter((r) => Number.isFinite(r.from));\n  if (!times.length) return [];\n  try {\n    const out = execFileSync('git', ['-C', cwd || '.', 'log', '-g', '-n', '500', '--date=unix', '--format=%H %gd %gs', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });\n    return out.split('\\n').flatMap((l) => {\n      const [, sha, at] = /^([0-9a-f]{40}) \\S*@\\{(\\d+)\\} commit/.exec(l) ?? [];\n      const r = sha && times.find((r) => at * 1000 >= r.from - 1000 && at * 1000 <= (r.to ?? Date.now()) + 1000);\n      return r ? [{ sha, mine: r.mine }] : [];\n    }).reverse();\n  } catch {\n    return [];\n  }\n}\n\n/** The checkout's newest commits, each its id and message, for the server to say which are not accounted for. */\nfunction recentCommits(cwd) {\n  try {\n    const out = execFileSync('git', ['-C', cwd, 'log', '-40', '--format=%H%x1f%B%x1e'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });\n    return out.split('\\x1e').map((one) => one.trim()).filter(Boolean).map((one) => ({ id: one.split('\\x1f')[0], message: one.slice(one.indexOf('\\x1f') + 1).trim() }));\n  } catch {\n    return [];\n  }\n}\n\n/**\n * Where the checkout stands, for the next session to know what this one left: its branch and commit, its folder, how\n * many of its commits no remote has, and how many files are changed and not committed. Null outside a checkout.\n */\nfunction gitState(cwd) {\n  const git = (...args) => execFileSync('git', ['-C', cwd || '.', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();\n  try {\n    const head = git('rev-parse', 'HEAD');\n    return { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), head, worktree: git('rev-parse', '--show-toplevel'), unpushed: Number(git('rev-list', '--count', head, '--not', '--remotes')), dirty: git('status', '--porcelain').split('\\n').filter(Boolean).length };\n  } catch {\n    return null;\n  }\n}\n\n/** The file in the checkout's git folder (shared by its worktrees) that holds a session's run, or null outside a checkout. */\nfunction runFile(said) {\n  if (typeof said.session_id !== 'string' || !/^[\\w-]+$/.test(said.session_id)) return null;\n  const cwd = said.cwd || '.';\n  try {\n    const git = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();\n    return git ? resolve(cwd, git, 'pelago-runs', said.session_id) : null;\n  } catch {\n    return null;\n  }\n}\n\n// What the session did, as the events of docs/sessions.md (pelago-events.mjs, handed out beside this). One\n// missing (a copy from before it) tells nothing: the hook goes on as before.\nconst adapter = await import('./pelago-events.mjs').catch(() => null);\n\n/** A wait the session stopped for, kept outside any checkout until something shows it was answered. */\nconst waitFile = (said) => (typeof said.session_id === 'string' && /^[\\w-]+$/.test(said.session_id) ? resolve(tmpdir(), 'pelago-waits', said.session_id) : null);\nfunction waitEnded(said) {\n  const file = waitFile(said);\n  try {\n    const kept = file && readFileSync(file, 'utf8');\n    if (!kept) return [];\n    rmSync(file, { force: true });\n    return [{ at: new Date().toISOString(), kind: 'wait.end', ...(said.prompt_id && { turn: said.prompt_id }), for: kept.trim() }];\n  } catch {\n    return [];\n  }\n}\n\n/** Sends events to /hooks/events, briefly: a server away, or one without the route yet, costs the turn nothing. */\nasync function sendEvents(said, events) {\n  if (!events.length || typeof said.session_id !== 'string') return;\n  await fetch(`${base}/hooks/events`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },\n    body: JSON.stringify({ session_id: said.session_id, source: 'claude-code', events }),\n    signal: AbortSignal.timeout(3_000),\n  }).catch(() => null);\n}\n\n// The hooks that only tell events: a wait begun or answered, a turn that ended in an error.\nif (name === 'notification' || name === 'tool-used' || name === 'stop-failure') {\n  try {\n    const said = JSON.parse(input || '{}');\n    const wait = name === 'notification' && adapter?.waitStart(said);\n    const file = wait && waitFile(said);\n    if (file) mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, wait.for);\n    if (adapter) await sendEvents(said, wait ? [wait] : name === 'tool-used' ? waitEnded(said) : name === 'stop-failure' ? [...waitEnded(said), adapter.failedEnd(said)] : []);\n  } catch {\n    // Not JSON, or nothing to say: the session goes on.\n  }\n  process.exit(0);\n}\n\nlet body = input.trim() || '{}';\nlet transcript = '';\nif (name === 'session-start') {\n  // Which repository this is, by the address it was cloned from: a folder is somewhere else on every machine.\n  try {\n    const said = JSON.parse(body);\n    const remote = execFileSync('git', ['-C', said.cwd || '.', 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();\n    // An address can carry a name and a password for the host (https://name:secret@host/...): those stay here.\n    if (remote) body = JSON.stringify({ ...said, remote: remote.replace(/^([a-z][a-z0-9+.-]*:[/][/])[^/@]*@/i, '$1'), commits: recentCommits(said.cwd || '.') });\n  } catch {\n    // Not a checkout, or no git here: the folder is all there is to go on.\n  }\n  // A chat resumed has a title already: its tab is named by it from the start.\n  try {\n    const said = JSON.parse(body);\n    transcript = said.transcript_path ? readFileSync(said.transcript_path, 'utf8') : '';\n    const { title } = transcript ? readTranscript(transcript) : {};\n    if (title) body = JSON.stringify({ ...said, title });\n  } catch {\n    // No record yet: a new chat has no title until it is given one.\n  }\n} else if (name === 'file-used') {\n  // The path alone: what the tool read or wrote stays here.\n  try {\n    const said = JSON.parse(body);\n    const path = said.tool_input?.file_path ?? said.tool_input?.notebook_path;\n    if (typeof path !== 'string') process.exit(0);\n    const told = runFile(said);\n    let before = [];\n    try {\n      before = told ? readFileSync(`${told}.said`, 'utf8').split('\\n').filter(Boolean) : [];\n    } catch {\n      // Nothing said yet.\n    }\n    body = JSON.stringify({ session_id: said.session_id, cwd: said.cwd, path, said: before });\n  } catch {\n    process.exit(0);\n  }\n} else {\n  try {\n    const said = JSON.parse(body);\n    if (said.transcript_path) {\n      transcript = readFileSync(said.transcript_path, 'utf8');\n      const { made, turnMade, ran, ...read } = readTranscript(transcript);\n      const log = logged(said.cwd, ran);\n      const commits = [...new Set([...fullIds(said.cwd, made), ...log.map((c) => c.sha)])];\n      const turnCommits = read.reply?.pushed ? commits : [...new Set([...fullIds(said.cwd, turnMade ?? []), ...log.filter((c) => c.mine).map((c) => c.sha)])];\n      body = JSON.stringify({ ...said, ...read, commits, ...(read.turn && { turn_commits: turnCommits }) });\n    }\n  } catch {\n    // No count this time; what the hook is for still goes through.\n  }\n  // At a turn's end and at the end, where the checkout stands: so what a session leaves unpushed is known after it.\n  if (name === 'stop' || name === 'session-end') {\n    try {\n      const said = JSON.parse(body);\n      const git = gitState(said.cwd);\n      if (git) body = JSON.stringify({ ...said, stands: git });\n    } catch {\n      // Not JSON: it goes as it came.\n    }\n  }\n}\n\ntry {\n  body = JSON.stringify({ ...JSON.parse(body), setup: SETUP });\n} catch {\n  // Not JSON: it goes as it came.\n}\n\n// The events this hook tells, beside its own call; at a turn's end after it, as its answer may send the reply on.\nconst said = (() => { try { return JSON.parse(input || '{}'); } catch { return {}; } })();\nlet events = [];\nif (adapter) try {\n  const at = new Date().toISOString();\n  if (name === 'session-start') {\n    const { title } = JSON.parse(body);\n    const branch = (() => { try { return execFileSync('git', ['-C', said.cwd || '.', 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(); } catch { return ''; } })();\n    events = [{ at, kind: 'session.start', ...((title ?? said.session_title) && { title: title ?? said.session_title }), ...(branch && { branch }) }];\n  } else if (name === 'prompt') events = [...(transcript ? adapter.turnEvents(transcript, said) : []), ...waitEnded(said), { at, kind: 'turn.start', ...(said.prompt_id && { turn: said.prompt_id }), ...adapter.promptedBy(said.prompt) }];\n  else if (name === 'stop') events = [...(transcript ? adapter.turnEvents(transcript) : []).map((e) => (e.turn || !said.prompt_id ? e : { ...e, turn: said.prompt_id })), ...waitEnded(said)];\n  else if (name === 'session-end') events = [...waitEnded(said), { at, kind: 'session.end', ...(typeof said.reason === 'string' && { reason: said.reason.slice(0, 40) }) }];\n  // A commit by its full id, where the checkout has it.\n  const full = fullIds(said.cwd, events.filter((e) => e.kind === 'commit').map((e) => e.sha));\n  events = events.map((e) => (e.kind === 'commit' ? { ...e, sha: full.find((f) => f.startsWith(e.sha)) ?? e.sha } : e));\n} catch {\n  // Nothing to tell this time; what the hook is for still goes through.\n}\nconst telling = name === 'stop' ? null : sendEvents(said, events);\nlet answered = '';\n\nconst post = (event, payload) =>\n  fetch(`${base}/hooks/${event}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: payload, signal: AbortSignal.timeout(10_000) });\n/** The run the server named for this session, kept for the commit-msg hook. */\nfunction keepRun(res, sent) {\n  const run = res.headers.get('x-pelago-run');\n  if (!run || !/^[\\w-]+$/.test(run)) return;\n  try {\n    const file = runFile(JSON.parse(sent));\n    if (file) {\n      mkdirSync(resolve(file, '..'), { recursive: true });\n      writeFileSync(file, run);\n      if (/^\\d+$/.test(process.env.CLAUDE_PID ?? '')) writeFileSync(`${file}.pid`, process.env.CLAUDE_PID);\n      return run;\n    }\n  } catch (err) {\n    console.error(`Archipelago ${name} hook: the run could not be kept for commits (${err.message})`);\n  }\n  // Outside a git checkout there are no commits to name it in.\n  return undefined;\n}\n\n/** What goes wrong is said to the person in the session, once a session for each thing, not at every turn. */\nfunction sayOnce(kind, words) {\n  console.error(words);\n  const file = typeof said.session_id === 'string' && /^[\\w-]+$/.test(said.session_id) ? resolve(tmpdir(), 'pelago-said', `${said.session_id}-${kind}`) : null;\n  try {\n    if (file) mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, '', { flag: 'wx' });\n    return words;\n  } catch {\n    return '';\n  }\n}\n// What this hook says beside the server's answer: context for the agent, and a line the person sees.\nconst plugin = process.argv.includes('--plugin') ? login?.plugin(said, import.meta.url) : null;\nconst context = [];\nlet notice = '';\nlet out = null;\n\ntry {\n  // A session that started before its sign-in is registered at its first prompt after.\n  const late = name === 'prompt' && token ? plugin?.lateStart() : null;\n  if (late) {\n    const res = await post('session-start', late);\n    if (res.ok) context.push(plugin.fromServer(await res.text())?.hookSpecificOutput?.additionalContext, plugin.rules(), plugin.trailer(keepRun(res, late), said.cwd));\n  }\n  const res = await post(name, body);\n  const answer = (answered = await res.text());\n  if (res.status === 401 && plugin && !process.env.PELAGO_AGENT_TOKEN) {\n    // No sign-in, or one the server no longer takes: the person is asked to sign in, in the browser.\n    if (token) login.forget(base);\n    if (name === 'session-start' || name === 'prompt') {\n      const asked = await plugin.askSignIn(base, name === 'session-start' && body);\n      notice = asked.notice;\n      context.push(asked.context);\n    }\n  } else if (res.ok && name === 'file-used') {\n    // What it said is kept, so the next file's answer leaves it out; the rest is Claude Code's.\n    const { said: ids, ...rest } = JSON.parse(answer || '{}');\n    const told = Array.isArray(ids) && ids.length ? runFile(JSON.parse(body)) : null;\n    if (told) {\n      mkdirSync(resolve(told, '..'), { recursive: true });\n      appendFileSync(`${told}.said`, ids.map((id) => `${id}\\n`).join(''));\n    }\n    out = rest;\n  } else if (res.ok) {\n    out = answer;\n    if (name === 'session-start') {\n      const run = keepRun(res, body);\n      if (plugin) (out = plugin.fromServer(answer)), context.push(plugin.rules(), plugin.trailer(run, said.cwd));\n    }\n  } else notice = sayOnce(`status-${res.status}`, `Archipelago ${name} hook: ${base} answered ${res.status}${res.status === 401 || res.status === 403 ? `: this machine ${token ? 'has a token the server refused' : 'has no token for it'}, so this session is not on the map` : ''}.`);\n} catch (err) {\n  notice = sayOnce('away', `Archipelago ${name} hook: ${base} did not answer (${err.message}), so this session’s work is not reaching the map.`);\n}\nconst written = login && (context.length || notice) ? login.withSaid(out, name, context, notice) : notice ? { systemMessage: notice } : out;\nif (written) process.stdout.write(typeof written === 'string' ? written : JSON.stringify(written));\n// A reply the server sends on has not ended: its turn goes on.\nif (name === 'stop') {\n  try {\n    if (adapter && !/\"decision\"\\s*:\\s*\"block\"/.test(answered)) events.push(adapter.turnEnd(transcript, said));\n  } catch {\n    // No end to tell: the next prompt opens the next turn all the same.\n  }\n  await sendEvents(said, events);\n} else await telling;\n\n// A session that has ended makes no more commits: its run is not left for another to be named by.\nif (name === 'session-end') {\n  try {\n    const file = runFile(JSON.parse(body));\n    if (file) for (const kept of [file, `${file}.said`, `${file}.pid`]) rmSync(kept, { force: true });\n  } catch {\n    // Nothing kept, or nothing to read it by.\n  }\n}\n\n/** Whether a process is still running: one that is gone answers ESRCH; one that is another user's, EPERM. */\nfunction alive(pid) {\n  try {\n    process.kill(pid, 0);\n    return true;\n  } catch (err) {\n    return err.code !== 'ESRCH';\n  }\n}\n\n// A chat archived or closed whose own end was not heard: its Claude Code is gone, so its run is ended for it, and\n// what was kept for it goes. Looked for as a session starts, is prompted or ends a turn, in the checkout's git folder.\nif (name === 'session-start' || name === 'prompt' || name === 'stop') {\n  try {\n    const said = JSON.parse(body);\n    const file = runFile(said);\n    const folder = file && dirname(file);\n    const gone = folder ? readdirSync(folder).filter((f) => f.endsWith('.pid') && f !== `${said.session_id}.pid`).map((f) => f.slice(0, -4)).filter((id) => /^[\\w-]+$/.test(id) && !alive(Number(readFileSync(resolve(folder, `${id}.pid`), 'utf8')))) : [];\n    await Promise.all(\n      gone.map(async (id) => {\n        const res = await fetch(`${base}/hooks/session-end`, {\n          method: 'POST',\n          headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },\n          body: JSON.stringify({ session_id: id, cwd: said.cwd, reason: 'closed', setup: SETUP }),\n          signal: AbortSignal.timeout(5_000),\n        }).catch(() => null);\n        // Kept until the server has heard it, so a later hook tries again.\n        if (res?.ok) for (const kept of [id, `${id}.said`, `${id}.pid`]) rmSync(resolve(folder, kept), { force: true });\n      }),\n    );\n  } catch {\n    // No checkout, nothing kept, or the server away: the next hook looks again.\n  }\n}\n".replace("'http://127.0.0.1:3100'", JSON.stringify(ORIGIN)).replace("const SETUP = '';", `const SETUP = '${VERSION}';`);
const FILES = {
  hook: HANDED_HOOK,
  events: "// What a Claude Code session did, as the events of docs/sessions.md, read from what its hooks are given and from its\n// transcript: a gist of what was said, never a transcript. The hook (pelago-hook.mjs) loads it and sends what it\n// answers to /hooks/events, as eventsPost has every adapter send them (the Agent SDK's runner,\n// pelago-sdk-runner.mjs, reads its tools and replies through callEvents and replyEnd too); nothing here reads a\n// file, the network or the environment, so it is tested as input\n// in, events out (test/hook-events.test.ts). A turn is named by Claude Code's prompt_id (promptId on the\n// transcript's lines); the tools of a turn, its tests and commits are read off the transcript, each at its own\n// time, so sending them again changes nothing.\n\n// As the hook reads them: the map's tools (and any other workspace's), an item's id, the tools that write a file,\n// a commit command, a line of the transcript's text, and a message its person wrote.\nconst MAP_TOOL = /^mcp__(plugin_[\\w-]+?_)?pelago__/;\nconst ANY_MAP_TOOL = /^mcp__(plugin_[\\w-]+?_)?pelago([-_][\\w-]*?)?__/;\nconst ITEM = /\\be_[a-z0-9]{8}\\b/g;\nconst EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);\nconst COMMIT = new RegExp(String.raw`(^|[\\s;&|(])git(\\s+(-[Cc]\\s+(\"[^\"]*\"|'[^']*'|\\S+)|--?[\\w-]+(=\\S+)?))*\\s+commit(?![\\w-])`);\nconst textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('\\n') : '');\nconst prompted = (entry) =>\n  entry.type === 'user' &&\n  !entry.isMeta &&\n  !entry.isCompactSummary &&\n  (typeof entry.message?.content === 'string' ||\n    (Array.isArray(entry.message?.content) && entry.message.content.some((p) => p.type === 'text') && !entry.message.content.some((p) => p.type === 'tool_result')));\n\nconst REMINDER = /<system-reminder>[\\s\\S]*?<\\/system-reminder>/g;\nexport const gist = (text, n = 200) => {\n  const line = String(text ?? '').replace(REMINDER, '').replace(/<[^>\\n]+>/g, ' ').trim().split(/\\n\\s*\\n|\\n/)[0]?.trim() ?? '';\n  return (/^[\\s\\S]*?[.!?](?=\\s|$)/.exec(line)?.[0] ?? line).slice(0, n) || undefined;\n};\nconst INTERRUPTED = /^\\[Request interrupted by user/;\n/** Who a prompt is from: its person, another session, or an event the app or Claude Code put in. */\nexport function promptedBy(prompt) {\n  const text = String(prompt ?? '').replace(REMINDER, '').trim();\n  const peer = /<cross-session-message from=\"([^\"]+)\"/.exec(text);\n  if (peer) return { by: 'session', from: peer[1] };\n  if (/^(Background|Task) \\(from the session that started this one\\)/.test(text)) return { by: 'session' };\n  const tag = /^(?:Another Claude session sent a message:\\s*)?<([a-z][\\w-]*)[\\s>]/.exec(text)?.[1];\n  if (tag && (/-(event|message|notification)$/.test(tag) || tag === 'scheduled-task')) return { by: 'event', from: tag };\n  return { by: 'person', gist: gist(text) };\n}\nconst TESTS = /(^|[\\s;&|(])(npm (run )?test(:[\\w-]+)?|npx (vitest|jest|playwright test)|node --test|vitest|jest|pytest|dotnet test|cargo test|go test)(?![\\w-])/;\nexport const kindOf = (tool) =>\n  ANY_MAP_TOOL.test(tool) ? 'map' : EDITS.has(tool) ? 'edit' : /^(Read|NotebookRead)$/.test(tool) ? 'read' : /^(Bash|PowerShell|BashOutput)$/.test(tool) ? 'shell'\n    : /^(Grep|Glob|LS|ToolSearch)$/.test(tool) ? 'search' : /^(WebFetch|WebSearch)$/.test(tool) || /Browser|chrome/.test(tool) ? 'web' : /^(Agent|Task)$/.test(tool) ? 'agent' : 'other';\nconst count = (out, re) => Number(re.exec(out)?.[1] ?? NaN);\n\nconst entriesOf = (text) => text.split('\\n').flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });\nconst startsTurn = (e) => prompted(e) && !INTERRUPTED.test(textOf(e.message.content));\n\n/**\n * What one tool call says once its result is back: its tool.end, and the test.run or commits a shell call made. Any\n * source's adapter that has the call (a tool_use block) and its result (a tool_result block) reads them so.\n */\nexport function callEvents(call, part, at, turn) {\n  const events = [];\n  const ok = !part.is_error, out = textOf(part.content), input = call.input ?? {};\n  const file = EDITS.has(call.name) && (input.file_path ?? input.notebook_path);\n  const items = MAP_TOOL.test(call.name) ? [...new Set([...JSON.stringify(input).matchAll(ITEM), ...(call.name.endsWith('__change') ? out.matchAll(ITEM) : [])].map((m) => m[0]))] : [];\n  events.push({ at, kind: 'tool.end', turn, tool: kindOf(call.name), name: call.name, ok, ...(file && { files: [file] }), ...(items.length && { items }) });\n  const command = typeof input.command === 'string' ? input.command : '';\n  if (kindOf(call.name) === 'shell' && TESTS.test(command)) {\n    const passed = count(out, /^[ℹ#] pass (\\d+)/m) || count(out, /(\\d+) passed/);\n    const failed = Number.isFinite(count(out, /^[ℹ#] fail (\\d+)/m)) ? count(out, /^[ℹ#] fail (\\d+)/m) : count(out, /(\\d+) failed/);\n    events.push({ at, kind: 'test.run', turn, ok: ok && !(failed > 0), ...(Number.isFinite(passed) && { passed }), ...(Number.isFinite(failed) && { failed }), command: command.slice(0, 120) });\n  }\n  if (kindOf(call.name) === 'shell' && COMMIT.test(command)) for (const m of out.matchAll(/^\\[[^\\]\\n]*? ([0-9a-f]{7,40})\\] (.*)$/gm)) events.push({ at, kind: 'commit', turn, sha: m[1], subject: m[2].slice(0, 200) });\n  return events;\n}\n\n/**\n * The events of the transcript's last turn: its tools, tests and commits. Given the prompt just sent (`current`),\n * of the turn before it, and that turn's end when its person stopped it: a turn stopped hears no Stop.\n */\nexport function turnEvents(text, current) {\n  const entries = entriesOf(text);\n  const starts = entries.flatMap((e, i) => (startsTurn(e) ? [i] : []));\n  const now = current && starts.length && (entries[starts.at(-1)].promptId === current.prompt_id || textOf(entries[starts.at(-1)].message.content).trim() === String(current.prompt ?? '').trim());\n  const from = starts.at(now ? -2 : -1);\n  if (from === undefined) return [];\n  const turnEntries = entries.slice(from, now ? starts.at(-1) : undefined);\n  const ending = Boolean(current);\n  const turn = turnEntries[0].promptId;\n  const calls = new Map();\n  const events = [];\n  for (const e of turnEntries) {\n    for (const part of Array.isArray(e.message?.content) ? e.message.content : []) {\n      if (part.type === 'tool_use') calls.set(part.id, part);\n      const call = part.type === 'tool_result' && calls.get(part.tool_use_id);\n      if (call) events.push(...callEvents(call, part, e.timestamp, turn));\n    }\n  }\n  const last = turnEntries.at(-1);\n  if (ending && last?.type === 'user' && INTERRUPTED.test(textOf(last.message?.content))) events.push({ at: last.timestamp, kind: 'turn.end', turn, ended: 'stopped' });\n  return events.map((e) => (e.turn ? e : (({ turn: _, ...rest }) => rest)(e)));\n}\n\n/** How the transcript's last turn ended, for its Stop: on a question or not, its reply's gist, and what it used. */\nexport function turnEnd(text, said) {\n  const entries = entriesOf(text);\n  const from = entries.findLastIndex(startsTurn);\n  const turnEntries = from < 0 ? [] : entries.slice(from);\n  const used = new Map();\n  let asked, reply;\n  for (const e of turnEntries) {\n    if (e.type !== 'assistant') continue;\n    const u = e.message?.usage;\n    if (u) used.set(e.message.id ?? e.uuid, tokensOf(u));\n    for (const part of Array.isArray(e.message?.content) ? e.message.content : []) {\n      if (part.type === 'tool_use' && /__wrap_up$/.test(part.name ?? '')) asked = typeof part.input?.ask === 'string' && part.input.ask.trim() ? part.input.ask.trim() : undefined;\n      if (part.type === 'text' && part.text?.trim()) reply = part.text;\n    }\n  }\n  reply = typeof said.last_assistant_message === 'string' && said.last_assistant_message.trim() ? said.last_assistant_message : reply;\n  const tokens = [...used.values()].reduce((sum, u) => Object.fromEntries(Object.keys(u).map((k) => [k, sum[k] + u[k]])), { input: 0, output: 0, cache_read: 0, cache_write: 0 });\n  const turn = said.prompt_id ?? turnEntries[0]?.promptId;\n  return { at: new Date().toISOString(), kind: 'turn.end', ...(turn && { turn }), ...replyEnd(reply, asked), ...(used.size && { tokens }) };\n}\n\n/** A Messages API usage as the vocabulary counts tokens. */\nexport const tokensOf = (u) => ({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 });\n\n/** How a reply ends its turn: on a question (the one it was told to ask, else its last paragraph's) or done, and its gist. */\nexport function replyEnd(reply, asked) {\n  const paragraph = String(reply ?? '').trim().split(/\\n\\s*\\n/).at(-1)?.trim() ?? '';\n  const question = asked ?? (paragraph.endsWith('?') ? paragraph : undefined);\n  return { ended: question ? 'asked' : 'done', ...(question && { question: question.slice(0, 500) }), ...(gist(reply) && { gist: gist(reply) }) };\n}\n\n/** What a Notification hook says the session waits on, or null: permission for a tool, or an answer from its person. */\nexport function waitStart(said, at = new Date().toISOString()) {\n  const type = said.notification_type ?? (/permission/i.test(said.message ?? '') ? 'permission_prompt' : undefined);\n  const waits = type === 'permission_prompt' ? 'permission' : /^(elicitation_dialog|elicitation_url_dialog|agent_needs_input)$/.test(type ?? '') ? 'input' : null;\n  return waits && { at, kind: 'wait.start', ...(said.prompt_id && { turn: said.prompt_id }), for: waits, ...(gist(said.message) && { gist: gist(said.message) }) };\n}\n\n/** A turn that ended in an error (StopFailure): what the error was, as its gist. */\nexport function failedEnd(said, at = new Date().toISOString()) {\n  const said_ = gist(said.error ?? said.last_assistant_message);\n  return { at, kind: 'turn.end', ...(said.prompt_id && { turn: said.prompt_id }), ended: 'failed', ...(said_ && { gist: said_ }) };\n}\n\n/** The request that sends a batch of events to /hooks/events, as fetch takes it (url, init): every adapter sends them so. */\nexport const eventsPost = ({ base, token, session_id, source, events }) => [\n  `${String(base).replace(/\\/$/, '')}/hooks/events`,\n  { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify({ session_id, source, events }) },\n];\n",
  skill: "---\nname: pelago-bump\ndescription: >-\n  Record friction with Archipelago on the Archipelago map, the moment it happens. Use this whenever Archipelago itself gets in the way while you work, in any repository: a pelago tool errors or refuses something reasonable, you need a second call or a workaround to do one thing, a view lacks what you needed or answers with something stale or wrong, a tool description misled you, the web UI shows something badly, a hook or the GitHub workflow misbehaves, or the owner complains about how Archipelago behaves or looks. Also use it when the owner says \"bump\", \"note that\", \"that was annoying\" or \"record that\" about Archipelago. Do not wait to be asked: a bump nobody wrote down is hit again by the next session.\n---\n\n# Archipelago bump\n\nArchipelago is built by using it. Every time it slows you or the owner down, that\nis a finding about the product, and it is only worth something if it is on the\nmap, where the next session will see it in the repository's work list. A bump\nleft in the chat is lost when the chat ends.\n\nRecording one takes a minute. Do it when it happens, then go back to what you\nwere doing. Do not stop to fix it unless the owner asks or the fix is a line.\n\n## What counts\n\nAnything where Archipelago, not the task, cost you something:\n\n- a tool call that failed, or needed a retry in a different shape;\n- something that took several calls and should take one;\n- a workaround (going around the tools with curl, resending a whole body to\n  change a line, guessing an id);\n- an answer that was stale, wrong, far too large, or missing the one field you\n  needed;\n- a description, hook text or CLAUDE.md line that sent you the wrong way;\n- anything in the web UI the owner had to squint at, or said was bad;\n- the hosted server, a hook or the Actions workflow not doing what it says;\n- the map saying something the code no longer bears out: an item still \"not\n  merged\" after the merge, a \"Left\" list another commit has done, a title\n  stating a problem that is fixed, \"doing\" on merged work, a handoff that\n  names the wrong head.\n\nWhat does not count: a bug in the code you are working on, or a mistake of\nyour own that Archipelago could not have prevented. If Archipelago could have\nprevented it cheaply, it counts.\n\n## How to record one\n\n1. **Find the home.** Bumps live as issues under the Archipelago project's feature\n   for friction. `query` with name `search`, params type `feature` and q\n   `friction`; `references/home.md` says the same for this workspace. If there\n   is none, create the issue as part of the Archipelago project instead. On a\n   map with islands, a bump is of the type the home's island takes: `bug` where\n   it speaks code, `issue` where it speaks work (a refusal names which). A map\n   with no `issue` type (`query` `schema` says which it has) takes each bump as\n   a `finding` linked `about` the item it concerns, in the same shape below.\n\n2. **Look for it first.** `query` `search` with that type, `open: true`, and\n   one distinctive word of what happened in q (a search of several words can\n   miss what one finds). The same bump is usually already there.\n\n3. **If it is there, add to it.** `query` `get` it, then `change` it with an `update` op that appends one\n   more dated line under \"Seen\": what you were doing and what happened. A bump\n   seen five times matters more than one seen once, and the lines are how\n   anyone can tell. If it was marked resolved and you have just hit it again,\n   reopen it and say so.\n\n4. **If it is new, create an issue**, part of the friction feature:\n   - **Title**: what is wrong, named in a few plain words a person would nod\n     at, 60 characters at most (the server refuses longer from an agent).\n     \"A long note is re-sent whole to change a line\", not \"body update UX\"\n     and not a full sentence with its consequence: that is the note's first\n     line.\n   - **Body**, short, in this shape:\n\n     ```\n     Seen\n     - 8 Oct 2026, in pelago: updating a handoff six times in a session, each\n       time resending about 4,000 characters to change a sentence.\n\n     What I did instead\n     Resent the whole body.\n\n     What would make it smooth\n     An update that appends to, or replaces part of, a body.\n     ```\n\n   - **props**: `kind: \"problem\"`, and `severity`: `high` if it stopped the\n     work or lost something, `medium` if it cost real time or would mislead,\n     `low` if it is only awkward.\n   - **touches**, in props, where its type has the field (`query`\n     `schema` with that type): what it touched, so the snags view (the refine\n     pack's) can group it with the others that did. One or more of `pack:<id>`, `instruction:<id>`,\n     `tool:<name>`, `rule:<id>`, `view:<name>`, `hook:<event>` or\n     `page:<name>`, separated by spaces: `\"tool:change rule:finding_note\"`.\n     A refusal names its rule (`held_by`, or the id in its text): put\n     `rule:<that id>`. When adding a Seen line to a bump that has none, fill\n     it in then.\n   - **authority**: `{\"of\": \"agent\", \"basis\": \"<what you saw, in which session>\"}`.\n     If the owner said it, it is theirs: `of: \"human\"` with their words.\n   - Put exact error text in the body when there was one. It is what the\n     person fixing it will search for.\n\n5. **A map found out of date** is corrected before it is counted. Fix the item\n   itself first (its status, or a \"Stands at\" line rewritten, not appended),\n   then add one dated line under \"Seen\" on the open issue about the map going\n   stale (search q `stale`; create it if there is none), naming which cause it\n   was, so the causes are counted:\n   1. a body keeps \"not merged\" or \"not pushed\" after the merge;\n   2. the title or first line states a problem the fix below it removed;\n   3. another commit did part of the item's \"Left\" list;\n   4. \"doing\" lingers on merged work that waits only on a look;\n   5. the map heard nothing of commits that were not pushed;\n   6. the item read as confirmed because any edit counts as a check.\n\n6. **Say so in one line** in your next message to the owner (\"Recorded a\n   Archipelago bump: ...\"), and carry on.\n\n## When one is fixed\n\nWhen a change removes a bump, resolve its issue in the same breath, in the\nchange that records the commit (a commit item with its sha, linked settles to\nthe issue).\n\n## Keeping this smooth\n\nRecording a bump must itself stay cheap. If doing this took more than a couple\nof calls, or the search did not find a bump you later saw was there, that is a\nbump: record it.\n",
  home: `# Where bumps live\n\nWorkspace: ${ORIGIN}.\n\nFind the feature that gathers friction with Archipelago by search (type \`feature\`, q \`friction\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Archipelago itself; with no issue type here, a finding about the item it concerns.\n`,
  rules: {rules},
};
// Connect the project in this folder to an Archipelago server, or take Archipelago out of it again. The claude_code
// server pack hands this script out at GET /connect/setup.mjs with ORIGIN (the server's address), TOKENS and FILES
// (what to write) in front of it (packs/claude_code/sync.mjs). It is run once in each project, from that project's folder (the first time on a machine with
// the token carried in, which it then keeps for the machine), and can be run again: it writes only what is
// missing or has changed, and adds to .mcp.json, .claude/settings.json and CLAUDE.md without taking anything
// out of them. It holds no secret: the token is in the machine's environment (PELAGO_AGENT_TOKEN).
//
//   .mcp.json                         the pelago tools, for Claude Code
//   .claude/pelago-hook.mjs          tells Archipelago a session started, was prompted, ended
//   .claude/pelago-events.mjs        what the hook reads a session's events from (docs/sessions.md)
//   .claude/settings.json             the hooks that run it
//   .claude/skills/pelago-bump/      how to record friction with Archipelago
//   .claude/pelago.md                how to work with the map, read through CLAUDE.md
//   .claude/pelago-setup.json        what the setup wrote, so it can be taken out again
//   .worktreeinclude                 the ignored files above, which Claude Code then copies into each worktree it makes
//   .git/hooks/commit-msg            names, in a commit a session makes, the session's run (not where the project has
//                                    a commit-msg hook of its own, or its hooks are another tool's: core.hooksPath)
//
// It shows what it will change and asks before it writes. Options go after "--" at the end of the command:
//
//   --dry-run   show what would change and write nothing
//   --yes       write without asking
//   --remove    take out what the setup wrote, and nothing else
//   --machine   with --remove: also forget the address and token kept for this machine
//
// With nobody to ask (no terminal) and no --yes, it brings up to date only what Archipelago wrote here before, and
// refuses to set a project up for the first time.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const OPTIONS = ['--dry-run', '--yes', '--remove', '--machine'];
const given = process.argv.slice(1).filter((arg) => arg.startsWith('--'));
const unknown = given.filter((arg) => !OPTIONS.includes(arg));
if (unknown.length) {
  console.error(`Not an option of the setup: ${unknown.join(', ')}. It takes ${OPTIONS.join(', ')}. Nothing was written.`);
  process.exit(1);
}
const [DRY, YES, REMOVE, MACHINE] = OPTIONS.map((option) => given.includes(option));
const AGAIN = 'run the same command with  -- --yes  at its end';

const here = process.cwd();
const abs = (path) => join(here, path);
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const COPY = '.pelago-backup';
const copied = (file) => existsSync(file + COPY);
const MANIFEST = '.claude/pelago-setup.json';
const HOOK = '.claude/pelago-hook.mjs';
const RULES = '.claude/pelago.md';
const EVENTS = '.claude/pelago-events.mjs';
// The files that are Archipelago's own, whole: written by the setup and replaced by it when the server's change.
const OWN = { [HOOK]: FILES.hook, [EVENTS]: FILES.events, '.claude/skills/pelago-bump/SKILL.md': FILES.skill, '.claude/skills/pelago-bump/references/home.md': FILES.home, [RULES]: FILES.rules };
const SECTION = /(^|\n+)## Archipelago\n\nThis project's work is kept in Archipelago \([^)\n]*\)\. How to work with it:\n\n@\.claude\/pelago\.md\n*$/;
const section = `## Archipelago\n\nThis project's work is kept in Archipelago (${ORIGIN}). How to work with it:\n\n@${RULES}\n`;
const ourHook = /pelago-hook\.mjs/;
// The git hook that names the run of the session making a commit. The hook script keeps each session's run in the
// checkout's git folder (pelago-runs/<session id>, shared by its worktrees); Claude Code gives every command a
// session runs its id (CLAUDE_CODE_SESSION_ID). A commit made by a person has no session, and one made by a session
// Archipelago does not know has no run kept: either is left as it is. It is plain sh and git, so it works in a
// worktree that has none of the project's ignored files, and never stops a commit.
const COMMIT_MARK = '# Archipelago: names the run';
const COMMIT_HOOK = `#!/bin/sh
${COMMIT_MARK} of the Claude Code session making this commit. Written by Archipelago's setup, which takes it out again.
id="$CLAUDE_CODE_SESSION_ID"
case "$id" in ''|*[!A-Za-z0-9_-]*) exit 0 ;; esac
run=$(cat "$(git rev-parse --git-common-dir)/pelago-runs/$id" 2>/dev/null) || exit 0
case "$run" in ''|*[!A-Za-z0-9_-]*) exit 0 ;; esac
git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Archipelago-Run: $run" "$1" || true
exit 0
`;
// Claude Code copies into a worktree it makes (the desktop app's, --worktree, a subagent's) only the ignored files
// .worktreeinclude names. Without them a session there has no hooks, so no run, and its commits name none.
const INCLUDE = '.worktreeinclude';
const INCLUDE_MARK = "# Archipelago's setup: what it wrote, for each worktree Claude Code makes";
const CARRIED = ['.mcp.json', '.claude/settings.json', HOOK, EVENTS, RULES, '.claude/skills/pelago-bump/references/home.md'];
/** A .worktreeinclude without the setup's lines in it. */
const withoutCarried = (text) => {
  const lines = text.split('\n');
  const at = lines.indexOf(INCLUDE_MARK);
  if (at < 0) return text.trim();
  let end = at + 1;
  while (end < lines.length && CARRIED.includes(lines[end])) end++;
  return [...lines.slice(0, at), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
const reads = (text) => /@\.claude\/pelago\.md/.test(text ?? '');

// Every change is worked out first and made only once all of them are known: a file that cannot be read stops
// the run with nothing written. A step is one change: what will be done (will), what is said once it is (say),
// how to do it (make, or null when there is nothing to do), and whether it only renews what Archipelago already
// wrote here (own), which is all a run with nobody to ask may do.
const plan = [];
const did = [];

function parsed(path) {
  const was = read(abs(path));
  if (was === null) return {};
  try {
    return JSON.parse(was);
  } catch {
    console.error(`${path} is there but is not JSON. Fix or remove it, then run this again. Nothing was written.`);
    process.exit(1);
  }
}

/** A file is to hold this text. One that was there and is not Archipelago's own is copied beside itself first, once. */
function put(path, text, { own = false, verb = 'written  ', note = '' } = {}) {
  const file = abs(path);
  const was = read(file);
  if (was === text) return plan.push({ say: `as it was  ${path}`, make: null });
  const copy = !own && was !== null && !copied(file);
  plan.push({
    will: `${was === null ? 'write    ' : verb === 'added to ' ? 'add to   ' : 'change   '}  ${path}${note && `  ${note}`}${copy ? `  (a copy is kept: ${path}${COPY})` : ''}`,
    say: `${verb}  ${path}`,
    path,
    own,
    make: () => {
      mkdirSync(dirname(file), { recursive: true });
      if (copy) writeFileSync(file + COPY, was);
      writeFileSync(file, text);
    },
  });
}

/** A file is to go: all of it, or back to the text it would hold without Archipelago. */
function take(path, text, note = '', own = false) {
  const file = abs(path);
  if (text === null) plan.push({ will: `delete     ${path}${note && `  ${note}`}`, say: `deleted    ${path}`, path, own, make: () => rmSync(file) });
  else plan.push({ will: `change     ${path}${note && `  ${note}`}`, say: `changed    ${path}`, path, own, make: () => writeFileSync(file, text) });
}

/** Where git looks for this checkout's hooks and keeps its runs, relative to here; null outside a checkout, and other when another tool keeps its hooks (core.hooksPath). */
function gitFolder() {
  const git = (...args) => execFileSync('git', args, { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const at = (path) => relative(here, resolve(here, path)).replace(/\\/g, '/');
    const found = { hook: at(join(git('rev-parse', '--git-path', 'hooks'), 'commit-msg')), runs: at(join(git('rev-parse', '--git-common-dir'), 'pelago-runs')) };
    try {
      if (git('config', '--get', 'core.hooksPath')) return { ...found, other: true };
    } catch { /* not set */ }
    return found;
  } catch {
    return null;
  }
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const hasServer = (config) => Boolean(config.mcpServers?.pelago);
const hasHooks = (config) => ourHook.test(JSON.stringify(config.hooks ?? {}));

// Where the address and the token are kept for this person on this machine: on Windows the user's
// environment; elsewhere the shell's start-up file, and on a Mac also what apps opened from the Dock are given.
const profile = process.env.PELAGO_SETUP_PROFILE;
const inEnvironment = process.platform === 'win32' && !profile;
const startup = profile || join(homedir(), process.platform === 'darwin' || (process.env.SHELL ?? '').endsWith('zsh') ? '.zshenv' : '.profile');
const kept = /^export PELAGO_(URL|AGENT_TOKEN)=/;
const NAMES = ['PELAGO_URL', 'PELAGO_AGENT_TOKEN'];
const [URL_NAME, TOKEN_NAME] = NAMES;
const token = process.env[TOKEN_NAME];
const MACHINE_STEP = 'the address and token for this machine';
const notKept = (err) => console.error(`The address and token could not be kept for this machine (${err.message}). Set PELAGO_URL and PELAGO_AGENT_TOKEN yourself, then run this again.`);

function connect() {
  const mcp = parsed('.mcp.json');
  const mcpOwn = hasServer(mcp);
  mcp.mcpServers ??= {};
  mcp.mcpServers.pelago = { type: 'http', url: `\${${URL_NAME}:-${ORIGIN}}/mcp`, headers: { Authorization: `Bearer \${${TOKEN_NAME}:-none}` } };
  put('.mcp.json', json(mcp), { own: mcpOwn, note: mcpOwn ? '' : '(adds the pelago tools)' });

  put(HOOK, FILES.hook, { own: true });

  const settings = parsed('.claude/settings.json');
  const settingsOwn = hasHooks(settings);
  settings.hooks ??= {};
  // Claude Code gives a SessionEnd hook a second and a half unless it asks for more, too little to read the
  // session's record and its checkout before it says so: it asks for half a minute.
  // A wait asked for (Notification), a turn ended in an error (StopFailure) and a tool that ran once a wait was
  // answered (tool-used) only tell events; tool-used runs after every tool, so it runs beside the session (async).
  for (const [event, name, matcher, timeout, async] of [['SessionStart', 'session-start', 'startup|resume|clear'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end', undefined, 30], ['PostToolUse', 'file-used', 'Read|Edit|Write|MultiEdit|NotebookEdit'], ['Notification', 'notification'], ['StopFailure', 'stop-failure'], ['PostToolUse', 'tool-used', undefined, 10, true]]) {
    const list = (settings.hooks[event] ??= []);
    const command = `node ${HOOK} ${name}`;
    const named = (hook) => typeof hook.command === 'string' && ourHook.test(hook.command) && hook.command.trim().endsWith(` ${name}`);
    // A hook registered at another place (an older setup, or Archipelago's own repository running the script it
    // hands out) is pointed at the one written here: the other does not say which hand-out it is.
    for (const entry of list) for (const hook of entry.hooks ?? []) if (named(hook)) Object.assign(hook, { command }, timeout && { timeout }, async && { async });
    if (list.some((entry) => (entry.hooks ?? []).some(named))) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command, ...(timeout && { timeout }), ...(async && { async }) }] });
  }
  put('.claude/settings.json', json(settings), { own: settingsOwn, note: settingsOwn ? '' : '(adds the hooks that run the script above)' });

  for (const [path, text] of Object.entries(OWN)) if (path !== HOOK) put(path, text, { own: true });

  const git = gitFolder();
  const commit = git && read(abs(git.hook));
  if (git?.other) plan.push({ say: `left       the commit-msg hook  (this checkout's git hooks are another tool's, core.hooksPath: commits do not name their run)`, make: null });
  else if (commit === COMMIT_HOOK) plan.push({ say: `as it was  ${git.hook}`, make: null });
  else if (commit != null && !commit.includes(COMMIT_MARK)) plan.push({ say: `kept       ${git.hook}  (the project's own commit-msg hook: commits do not name their run)`, make: null });
  else if (git)
    plan.push({
      will: `${commit == null ? 'write    ' : 'change   '}  ${git.hook}  (names the session's run in a commit a session makes)`,
      say: `written    ${git.hook}`,
      path: git.hook,
      own: true,
      make: () => {
        mkdirSync(dirname(abs(git.hook)), { recursive: true });
        writeFileSync(abs(git.hook), COMMIT_HOOK);
        chmodSync(abs(git.hook), 0o755);
      },
    });
  const include = read(abs(INCLUDE));
  const rest = withoutCarried(include ?? '');
  // Its own lines, alone in a file of their own or kept before, are the setup's to renew with nobody to ask.
  const includeOwn = include === null || include.includes(INCLUDE_MARK);
  put(INCLUDE, `${rest ? `${rest}\n\n` : ''}${[INCLUDE_MARK, ...CARRIED].join('\n')}\n`, { own: includeOwn, verb: include ? 'added to ' : 'written  ', note: include?.includes(INCLUDE_MARK) ? '' : '(so a worktree Claude Code makes has the hooks)' });
  put(MANIFEST, json({ files: Object.fromEntries(Object.entries(OWN).map(([path, text]) => [path, sha(text)])) }), { own: true });

  // The first time on a machine, the command that runs this carries the token in and asks for it to be kept
  // (PELAGO_SETUP_SAVE): Claude Code and the hook find it there from then on. The token is never printed.
  if (process.env.PELAGO_SETUP_SAVE && token) {
    const keep = { PELAGO_URL: ORIGIN, PELAGO_AGENT_TOKEN: token };
    const say = 'kept       the server’s address and the token, for this machine';
    if (inEnvironment) {
      plan.push({
        will: `keep       ${NAMES.join(' and ')} in your Windows user environment, outside this folder`,
        say,
        path: MACHINE_STEP,
        machine: true,
        make: () => {
          for (const [name, value] of Object.entries(keep)) execFileSync('setx', [name, value], { stdio: 'ignore' });
        },
      });
    } else {
      try {
        const was = read(startup);
        const lines = (was ?? '').split('\n');
        // A value kept before (an older token) is replaced, not left beside the new one.
        const rest = lines.filter((line) => !kept.test(line));
        while (rest.length && rest.at(-1) === '') rest.pop();
        // The copy is of the file before Archipelago first added to it: once its lines are there, no copy is made.
        const copy = was !== null && !lines.some((line) => kept.test(line)) && !copied(startup);
        plan.push({
          will: `keep       ${NAMES.join(' and ')} in ${startup}, outside this folder${copy ? `  (a copy is kept: ${startup}${COPY})` : ''}`,
          say,
          path: MACHINE_STEP,
          machine: true,
            make: () => {
            if (copy) writeFileSync(startup + COPY, was, { mode: 0o600 });
            writeFileSync(startup, [...rest, ...Object.entries(keep).map(([name, value]) => `export ${name}="${value}"`), ''].join('\n'), { mode: 0o600 });
            if (process.platform === 'darwin' && !profile) for (const [name, value] of Object.entries(keep)) try { execFileSync('launchctl', ['setenv', name, value], { stdio: 'ignore' }); } catch { /* only apps opened from the Dock miss it */ }
          },
        });
      } catch (err) {
        notKept(err);
      }
    }
  }

  // CLAUDE.md is the project's own: one section is added to it, once, that reads the rules in. A project that
  // keeps its own setup out of git reads the rules in from CLAUDE.local.md instead.
  const had = read(abs('CLAUDE.md')) ?? '';
  const local = read(abs('CLAUDE.local.md'));
  // Where the rules are read in, the section the setup wrote is written again; words that are not the setup's stay.
  const renamed = (text) => (SECTION.test(text) ? text.replace(SECTION, (all, lead) => lead + section) : text);
  if (!reads(had) && !reads(local)) put('CLAUDE.md', `${had ? had.trimEnd() + '\n\n' : ''}${section}`, { verb: had ? 'added to ' : 'written  ', note: `(one section, which reads ${RULES} in)` });
  else for (const [path, text] of [['CLAUDE.md', had], ['CLAUDE.local.md', local ?? '']]) if (reads(text)) put(path, renamed(text), { own: true, verb: 'changed  ' });
}

function remove() {
  const mcp = parsed('.mcp.json');
  if (hasServer(mcp)) {
    delete mcp.mcpServers.pelago;
    if (!Object.keys(mcp.mcpServers).length) delete mcp.mcpServers;
    const empty = !Object.keys(mcp).length;
    take('.mcp.json', empty ? null : json(mcp), empty ? '(it holds nothing else)' : '(takes the pelago tools out)');
  }

  const settings = parsed('.claude/settings.json');
  if (hasHooks(settings)) {
    const ours = (hook) => typeof hook.command === 'string' && ourHook.test(hook.command);
    for (const [event, list] of Object.entries(settings.hooks)) {
      if (!Array.isArray(list)) continue;
      // An entry that held only Archipelago's hook goes; one that holds another's as well keeps that.
      settings.hooks[event] = list.filter((entry) => {
        if (!(entry.hooks ?? []).some(ours)) return true;
        entry.hooks = entry.hooks.filter((hook) => !ours(hook));
        return entry.hooks.length > 0;
      });
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    const empty = !Object.keys(settings).length;
    take('.claude/settings.json', empty ? null : json(settings), empty ? '(it holds nothing else)' : '(takes its hooks out)');
  }

  // What the setup wrote is known by the list it left. Without one (a project set up before there was a list),
  // a file is taken to be as written when it is what the server hands out today. One changed since is kept.
  let wrote = null;
  try {
    wrote = JSON.parse(read(abs(MANIFEST)) ?? 'null')?.files ?? null;
  } catch { /* an unreadable list is no list */ }
  for (const [path, text] of Object.entries(OWN)) {
    const was = read(abs(path));
    if (was === null) continue;
    // The hook is run, never written by hand: it goes whatever it holds.
    if (path === HOOK || sha(was) === (wrote?.[path] ?? sha(text))) take(path, null);
    else plan.push({ say: `kept       ${path}  (changed since the setup wrote it)`, make: null });
  }
  if (existsSync(abs(MANIFEST))) take(MANIFEST, null);
  const include = read(abs(INCLUDE));
  if (include?.includes(INCLUDE_MARK)) {
    const rest = withoutCarried(include);
    take(INCLUDE, rest ? `${rest}\n` : null, rest ? "(takes the setup's lines out)" : '(it holds nothing else)', true);
  }
  // The commit-msg hook goes only when it is the setup's, and the runs kept for it with it.
  const git = gitFolder();
  if (git && read(abs(git.hook))?.includes(COMMIT_MARK)) take(git.hook, null);
  if (git && existsSync(abs(git.runs))) plan.push({ will: `delete     ${git.runs}/  (the runs kept for the commit-msg hook)`, say: `deleted    ${git.runs}/`, path: git.runs, make: () => rmSync(abs(git.runs), { recursive: true, force: true }) });

  for (const path of ['CLAUDE.md', 'CLAUDE.local.md']) {
    const had = read(abs(path));
    if (had === null || !reads(had)) continue;
    const match = path === 'CLAUDE.md' && had.match(SECTION);
    if (!match) plan.push({ say: `kept       ${path}  (it reads ${RULES} in, in words that are not the setup’s: take that out yourself)`, make: null });
    else if (match.index === 0) take(path, null, '(it holds nothing else)');
    else take(path, had.slice(0, match.index).trimEnd() + '\n', '(takes the Archipelago section out)');
  }

  if (!MACHINE) return;
  const say = 'forgot     the server’s address and the token, on this machine';
  if (inEnvironment) {
    const there = NAMES.filter((name) => {
      try {
        execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });
    if (there.length)
      plan.push({
        will: `forget     ${there.join(' and ')} in your Windows user environment, outside this folder`,
        say,
        path: MACHINE_STEP,
        make: () => {
          for (const name of there) execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', name, '/f'], { stdio: 'ignore' });
        },
      });
  } else {
    const was = read(startup);
    const lines = (was ?? '').split('\n');
    if (lines.some((line) => kept.test(line)))
      plan.push({
        will: `forget     ${NAMES.join(' and ')} in ${startup}, outside this folder`,
        say,
        path: MACHINE_STEP,
        make: () => {
          writeFileSync(startup, lines.filter((line) => !kept.test(line)).join('\n'), { mode: 0o600 });
          if (process.platform === 'darwin' && !profile) for (const name of NAMES) try { execFileSync('launchctl', ['unsetenv', name], { stdio: 'ignore' }); } catch { /* it was not set there */ }
        },
      });
  }
}

// What was here before this run says whether it is a first setup: the hook is the one file every setup wrote.
const before = existsSync(abs(HOOK));
if (REMOVE) remove();
else connect();

const todo = plan.filter((step) => step.make);
let go = todo;
if (todo.length) {
  const show = (lead) => console.log(`${lead}\n\n${todo.map((step) => step.will).join('\n')}`);
  if (DRY) {
    show(`In ${here}, this would:`);
    console.log('\nNothing was written (--dry-run).');
    process.exit(0);
  } else if (YES) {
    // Said beforehand.
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    show(`In ${here}, this will:`);
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await ask.question('\nGo ahead? [y/N] ')).trim().toLowerCase();
    ask.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Nothing was written.');
      process.exit(0);
    }
    console.log('');
  } else if (REMOVE || !before) {
    show(`In ${here}, this would:`);
    console.error(`\nNothing was written: ${REMOVE ? 'taking Archipelago out' : 'this folder has nothing of Archipelago’s yet, and setting it up for the first time'} needs a yes, and nobody is here to give one. Read the above, then ${AGAIN}.`);
    process.exit(1);
  } else {
    // Nobody to ask, in a project set up before: what Archipelago wrote is brought up to date, the rest is left and said.
    go = todo.filter((step) => step.own);
  }
} else if (DRY) {
  console.log(REMOVE ? 'Nothing of the setup’s is in this folder.' : `${plan.map((step) => step.say).join('\n')}\n\nNothing would change.`);
  process.exit(0);
}

// Only now is anything written. Keeping the token is the one step that may fail and leave the rest standing.
for (const step of plan) {
  if (step.make && !go.includes(step)) {
    did.push(`not done   ${step.path}  (it needs a yes)`);
    continue;
  }
  try {
    step.make?.();
    did.push(step.say);
  } catch (err) {
    if (!step.machine) throw err;
    notKept(err);
  }
}

if (REMOVE) {
  // A folder the setup made and has now emptied goes too; one that holds anything else stays.
  for (const path of ['.claude/skills/pelago-bump/references', '.claude/skills/pelago-bump', '.claude/skills', '.claude']) try { rmdirSync(abs(path)); } catch { /* not empty, or not there */ }
  console.log(did.length ? did.join('\n') : 'Nothing of the setup’s is in this folder.');
  const copies = ['.mcp.json', '.claude/settings.json', 'CLAUDE.md'].map((path) => path + COPY).filter((path) => existsSync(abs(path)));
  if (todo.length) console.log(`\nArchipelago is out of ${here}. The map on the server was not touched.${copies.length ? ` The copies the setup kept are still here: ${copies.join(', ')}.` : ''}`);
  if (!MACHINE) console.log(`\nThe address and token kept for this machine were left: add --machine to forget them, and revoke the token on the Workspace screen at ${ORIGIN} to end it.`);
  process.exit(0);
}

console.log(did.join('\n'));
if (go.length < todo.length) console.log(`\nSome of it was left, because nobody was here to say yes. To do the rest, ${AGAIN}.`);

// Claude Code runs a folder's hooks and finds its skills only in a session opened in that folder. Set up in a
// folder that holds several repositories, a session in one of them reads the rules and is given nothing else.
let top = '';
try {
  top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* not in a repository, or no git */ }
const same = (a, b) => a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
if (!top || !same(top, here))
  console.log(
    `\nMind: ${here} is not the top folder of a git repository${top ? ` (that is ${top})` : ''}. A session reports to Archipelago only when Claude Code is opened in the folder this was run in: run it in each repository's own folder.`,
  );
console.log(
  token || !TOKENS
    ? `\nConnected to ${ORIGIN}${token ? '' : ', which asks for no token'}. Quit Claude Code completely${process.platform === 'win32' ? ' (from the system tray too)' : ''}, open it again in this folder, and the session will say it is registered in Archipelago.`
    : `\nThe files are in place, but this machine has no token yet. On the Workspace screen at ${ORIGIN}, press Connect an agent and run the command it gives under 1, in this folder.`,
);
