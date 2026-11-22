# gateway

The adapter's MCP server for the owner's Claude apps away from the machine:
claude.ai on the web, the desktop app and the phone app, added as a custom
connector. They call from Anthropic's cloud, so they need a public HTTPS URL
with OAuth; the adapter ([claude-code](../claude-code/README.md)) listens on
127.0.0.1 with no sign-in and answers only its own Host, and stays so. The
gateway sits beside it, on 127.0.0.1 too, behind a TLS tunnel at a public
name, signs the owner in, and passes `/mcp` on to the adapter over loopback.

One owner, one passphrase. Server only. Injects `action.register`.

## What it serves

| Path | Is |
|---|---|
| `GET /.well-known/oauth-protected-resource` (and `…/mcp`) | RFC 9728: the resource `<issuer>/mcp`, its authorization server the issuer |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: PKCE `S256` only, public clients (`none`), scopes `mcp`, `offline_access` |
| `POST /register` | RFC 7591 registration, JSON. Every redirect URI must be in `config.redirects` exactly; at most 50 clients, unused ones dropped after a day |
| `GET /authorize` | Needs a registered client and redirect, `response_type=code` and an S256 `code_challenge`; shows the owner the client and where it sends them back, and asks for the passphrase |
| `POST /authorize` | Checks the passphrase and redirects with a code (60 s, once) and `iss` |
| `POST /token` | Form-encoded. `authorization_code` with `code_verifier`; `refresh_token`, rotated. Errors are RFC 6749's (`invalid_grant`, …) |
| `/mcp` | With `Authorization: Bearer <access token>`: POST, GET and DELETE go to the adapter. Without one, `401` and `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"` |

A request whose Host is not the issuer's, `127.0.0.1:<port>` or
`localhost:<port>` is refused 403 (DNS rebinding). Nothing answers CORS.

## How it keeps the map safe

- **Off unless configured.** With no `issuer` or no passphrase it listens on
  nothing and logs why. It never listens on anything but 127.0.0.1.
- **The passphrase** is set from the terminal only, never through an action
  (an agent on the map could call one), and kept as an scrypt hash (N 2^15,
  r 8) in `gateway.sqlite` in the data folder. Checks are constant time and
  one at a time. After 5 wrong ones (`maxFailures`) every sign-in is locked
  for 15 minutes (`lockout`), the right passphrase included; a sign-in page
  allows 3 tries. Setting it again revokes every grant.
- **The page** is CSRF-safe: the form's only key is an unguessable request id
  held on the server for 10 minutes with the client, redirect, PKCE
  challenge and state, so nothing the browser posts can change them; a post
  with another `Origin` is refused. No frames, no scripts, no referrer.
- **Redirects** are an allowlist, matched exactly: by default Claude's
  hosted callbacks, `https://claude.ai/api/mcp/auth_callback` (the one
  [Claude's docs](https://claude.com/docs/connectors/building/authentication)
  name) and `https://claude.com/api/mcp/auth_callback`. Claude Code's
  loopback redirects are not allowed: Claude Code reaches the adapter
  directly.
- **Tokens** are opaque, 256 bits, and kept only as SHA-256. Access tokens
  live an hour (`accessTtl`), refresh tokens 30 days (`refreshTtl`) and are
  rotated on every use. A code or refresh token used a second time revokes
  its grant, and every token of it.
- **The proxy** sends only the MCP headers (`content-type`, `accept`,
  `mcp-session-id`, `mcp-protocol-version`, `last-event-id`), with the
  adapter's own Host; Authorization, cookies, Origin and the tunnel's headers
  stay here. Answers stream back with only `content-type`, `cache-control`
  and the MCP headers. The upstream must be http on loopback.

What a signed-in client can do is what any MCP client of the adapter can:
its tools (`hear`, `act`, `get`, `query`, `tell`, `run`, `packs`), as a run
of its own. `act` reaches every declared action.

## Actions

| Action | Takes | Does |
|---|---|---|
| `gateway.grants` | `limit?`, `after?` | The grants, newest first: client name, redirect host, scope, made, last used, refreshable until, revoked. No token |
| `gateway.revoke` | `grant` or `all: true` | Revokes it, and its tokens stop at once. Writes nothing to the map, so there's no change set to undo: sign in again instead |

## Config

`issuer` (the public `https://name`, no path), `port` (5183), `upstream`
(`http://127.0.0.1:5181/mcp`), `db`, `redirects`, `accessTtl`,
`refreshTtl`, `maxFailures`, `lockout` (seconds), `onListen`, `log`.
[app/tree.ts](../../app/tree.ts) runs it at page + 3 with the adapter at
page + 1 and `db` at `<data>/gateway.sqlite`, when the server is started
with `--gateway https://name` (or `ARCHIPELAGO_GATEWAY`).

## Setting it up

For the live server (page 5180, so the gateway is 5183 and the adapter
5181). Run these in this checkout; live's data folder is the live
worktree's `app/.data`.

1. **A stable public name.** The issuer must stay the same, so use a named
   tunnel, not a quick one with a new name each run. Either
   - Cloudflare Tunnel, on a domain in your Cloudflare account:
     ```
     cloudflared tunnel login
     cloudflared tunnel create archipelago
     cloudflared tunnel route dns archipelago map.example.com
     cloudflared tunnel run --url http://127.0.0.1:5183 archipelago
     ```
   - or Tailscale Funnel: `tailscale funnel --bg 5183`, which serves
     `https://<machine>.<tailnet>.ts.net`.
2. **The passphrase**, at least 12 characters, asked twice without echo:
   ```
   npm run gateway:passphrase -- --data ../archipelago-live/app/.data
   ```
3. **Start live with the gateway on** (and again after every `promote` or
   `rollback`, from a shell where it is set):
   ```
   npm run live:stop
   ARCHIPELAGO_GATEWAY=https://map.example.com npm run live:start
   ```
   The log (`app/.data/server.log` in the worktree) says
   `gateway on http://127.0.0.1:5183, for https://map.example.com/mcp`, or
   why it is off. `curl https://map.example.com/mcp` answers 401.
4. **The connector.** In claude.ai, Settings → Connectors → Add custom
   connector: any name, URL `https://map.example.com/mcp`, nothing in the
   advanced settings. Connect: a page asks for the passphrase. It then shows
   in the phone app too.

To see or end what is signed in, act `gateway.grants` and `gateway.revoke`
(the `act` tool, from any MCP client). To stop it all, stop the tunnel,
or start the server without `ARCHIPELAGO_GATEWAY`.
