# Contributing

Thanks for looking. Archipelago is early, so issues that say what you tried
and what happened are as welcome as code.

## Getting set up

Follow the [quickstart](README.md#quickstart): Node 22.18 or later,
`npm install`, `npm run serve`. There is no build step. The
[guide](guide/README.md) explains the concepts and how to write a plugin.

## Making a change

- A new idea is a plugin, not kernel code. A plugin's effects are revertible:
  when it unloads, everything it registered goes.
- Every change to the map goes through a declared action; a UI never writes
  directly.
- A plugin's code comes with its tests, in `test/<plugin>.test.ts`.
- Docs change in the same commit as the code: the plugin's README, and the
  interface's `spec/<name>.md` when it changes.
- The interfaces in [spec/](spec/README.md) are versioned contracts. Open an
  issue before changing one, naming the capability and edition.
- Nothing private in commits: no tokens, no local paths, no personal data.

[CLAUDE.md](CLAUDE.md) has the full rules; it is also what an agent working
here reads.

## Before you open a pull request

```
npm run check
npm test
```

Both must pass; CI runs them on Ubuntu and Windows. Keep a pull request to
one change, and say in it what it changes and why.

## Reporting

Bugs and ideas: open an issue from a template. Security problems: see
[SECURITY.md](SECURITY.md), never a public issue.
