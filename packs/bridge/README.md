# bridge

Server capabilities in the browser. [server.ts](server.ts) (Node) serves
`agent.tree`, `exchange.read`, `exchange.watch`, `verdict.read`,
`action.list`, `action.invoke`, `graph.read` and `graph.watch` over HTTP and
one event stream; [client.ts](client.ts) (the page) provides the same keys
by calling it. Packs in the page inject them as if they ran there.

- Calls are made from the server pack's context intercepted with
  `config.actor`: whoever is at the page acts as that person. There is no
  sign-in yet; it listens on 127.0.0.1 and answers only `config.origins`.
- A watch takes its callback last; its calls come down the stream. The
  synchronous reads (`agent.tree.nodes`, `action.list.list`) are copies
  the client keeps fresh by the key's own watch.
- If the stream drops and returns (the server restarted), the client makes
  every watch again and refreshes its copies.
