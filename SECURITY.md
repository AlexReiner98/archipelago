# Security

Please report a vulnerability privately, through this repository's
**Security** tab, under **Report a vulnerability**. Don't open a public issue
for it.

## What to know

- Archipelago runs on one machine for one person. Its servers listen on
  127.0.0.1 only.
- The one way in from outside is the gateway, off unless the owner sets a
  passphrase and a tunnel to it: OAuth with PKCE in front of the MCP server
  ([packs/gateway](packs/gateway/README.md)).
- Installing a pack means trusting its code: packs are not sandboxed.
- Data lives in the ignored `.data/` folder, never in the repository.
