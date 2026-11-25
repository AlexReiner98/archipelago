# gate

A host's way in to its maps: sign in, sign up, and keeping a guest's map,
drawn over the map in one column. It is off unless config names where the
host answers (`at`). A map on one person's machine has no one to let in,
so it has none.

The gate holds no secret and checks nothing. It asks the host's path what
to offer, shows it, and posts what the person typed or chose back. Google,
codes, passwords, passkeys and accounts are all the host's.

```
#gate/sign-up ─▶ GET <at>?screen=sign-up ─▶ an offer: what to draw
person picks or types ─▶ POST <at> {step, …} ─▶ {go} leave for it · {sent} the code box · {error}
```

| File | Runs | What it is |
|---|---|---|
| [offer.ts](offer.ts) | both | The offer, the steps and the answers; `offerOf` keeps an offer to what the gate draws. Plain data |
| [index.ts](index.ts) | server | `gate.setup`: `{ at }`, or `{}` when off. Injects `action.register` |
| [view.ts](view.ts) | page | Fills `over` while the address is `#gate/<screen>`. Injects `action.invoke`, `slot.fill` |

## Opening it

The page's address opens it: `#gate/sign-in` or `#gate/sign-up`. Any link
can, so a host sets connect's `save` to `#gate/sign-up`, and the gate
needs to know nothing of connect. A link in the gate's own foot to `#`
closes it. `#gate/<screen>?failed=<why>` opens it with why a provider sent
the person back.

## What the host answers

`GET <at>?screen=<screen>`, an offer. Every part is optional but `title`.

| Part | Drawn as |
|---|---|
| `title`, `emblem` | the title, with a picture over it |
| `agree` `{text, docs}` | a box to tick, each document linked; the ways in wait for it |
| `providers` `[{id, label, mark}]` | a row each, the mark before the label |
| `email` `{code, password}` | the address; a password beside it; a code mailed and typed in place |
| `passkey` | "Use a passkey", and a passkey in the address's autofill on sign-in |
| `before` `[{id, label}]` | Signed in before, one line, a click each |
| `foot` `[{text, links}]` | last lines, centred |
| `error` | said under the form |

`POST <at>` with JSON, one step: `provider` `{provider, agree}`, `email`
`{email, password?, agree}`, `code` `{email, code, agree}`, `before`
`{id}`, `passkey-options`, then `passkey` with the browser's signed answer
(`id`, `clientDataJSON`, `authenticatorData`, `signature`, base64url). Each
step carries its `screen`. The answer is `{go}`, `{sent: true}`,
`{challenge, rpId}` for `passkey-options`, or `{error}`.

## What it won't follow

A link, an emblem or a mark that isn't a path on this origin (or a `#`
fragment) is dropped. `go` may also be an `https:` address, a provider's
page. A document under the box may be any `http(s)` address, opened in a
new tab.
