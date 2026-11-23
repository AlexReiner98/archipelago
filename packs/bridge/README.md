# bridge

Server capabilities in the browser. [server.ts](server.ts) (Node) serves
`agent.tree`, `exchange.read`, `exchange.watch`, `verdict.read`,
`action.list`, `action.invoke`, `graph.read`, `graph.watch`, `types.read`, `types.mark` (edition 10), `profile.read` and `docs.read` over HTTP and
one event stream; [client.ts](client.ts) (the page) provides the same keys
by calling it. Packs in the page inject them as if they ran there.

- Calls are made from the server pack's context intercepted with
  `config.actor`: whoever is at the page acts as that person. There is no
  sign-in yet; it listens on 127.0.0.1, and the runtime's guard
  ([runtime/guard.ts](../../runtime/guard.ts)) refuses another Host and an
  Origin not in `config.origins` (`config.hosts` adds Host values).
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
  hears each change. The status region shows it (packs/activity).
