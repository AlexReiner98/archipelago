# bridge

Server capabilities in the browser. [server.ts](server.ts) (Node) serves
`agent.tree`, `exchange.read`, `exchange.watch`,
`action.list`, `action.invoke`, `graph.read`, `graph.all`, `graph.watch`, `types.read`, `types.mark` (edition 10), `docs.read` and `claim.read` over HTTP and
one event stream; [client.ts](client.ts) (the page) provides the same keys
by calling it. Plugins in the page inject them as if they ran there.

- The bridge waits for each of those keys. A plugin from elsewhere (a
  plugin folder's) has it serve one more with `bridge.serve`:
  `serve(key, cap, sync?)`, given the capability it injected, served until
  that plugin unloads. The learning loop's served plugin (archipelago-loop) serves
  `verdict.read`, `profile.read` and `profile.hears` this way. `bridge.serve`
  is this plugin's key, not a spec contract. A page reads the keys as it
  loads (`GET /caps`), so a key served later is there on its next load.

- Calls are made from the server plugin's context intercepted with
  `config.actor`: whoever is at the page acts as that person. There is no
  sign-in yet; it listens on 127.0.0.1, and the runtime's guard
  ([runtime/guard.ts](../../runtime/guard.ts)) refuses another Host and an
  Origin not in `config.origins` (`config.hosts` adds Host values).
- A script or agent calling `POST /call` says who it is with `actor`,
  `{ "id": "agent:<name>", "kind": "agent" }`: the call is made as that
  agent, so its change sets are the agent's and the next run hears that an
  agent changed the map, not a person. Only an agent can be named (an id of
  letters, digits and `. _ : @ / -`): a caller can say it is less than the
  person at the page, never someone else. With no `actor`, it is the page's.
- A watch takes its callback last; its calls come down the stream. The
  synchronous reads (`agent.tree.nodes`, `action.list.list`) are copies
  the client keeps fresh by the key's own watch.
- If the stream drops and returns (the server restarted), the client makes
  every watch again and refreshes its copies.
- A stream the browser closes for good (an answer that isn't the stream,
  such as a proxy's 502 while the server behind it restarts) is opened
  again, after `config.retry` ms (1000), doubling to 30 s.
- The client also provides `bridge.link`, its own key: `state()` is
  `open` while the stream is up and `down` once it errs, and `watch(on)`
  hears each change. The status region shows it (plugins/activity).
