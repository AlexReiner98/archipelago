# Security

Please report a vulnerability privately, through this repository's
**Security** tab, under **Report a vulnerability**. Don't open a public issue
for it.

## What to know

- Archipelago runs on one machine for one person. Its servers listen on
  127.0.0.1 only.
- Packs are code, and they run with the server's rights: they can read and
  write what your user account can. They are not sandboxed, so only load
  packs you trust.
- Data lives in the ignored `.data/` folder, never in the repository.
