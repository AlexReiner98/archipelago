# Security

## Reporting a problem

Report it in private, not as a public issue: on this repository's page,
**Security**, then **Report a vulnerability**. That reaches the maintainer
alone.

Say what you found, how to make it happen, and what someone could do with
it. You get an answer once the maintainer has read it, and credit in the fix unless you
would rather not.

## What counts

Archipelago holds a map of someone's work and the tokens of the agents that
change it. A problem is anything that lets someone:

- read or change a workspace without a token for it, or one workspace from
  another;
- read what is private to another member of the same workspace;
- act with a human's authority while holding an agent's token: approve a
  held change, launch a session, make or revoke tokens;
- write beyond the items a token is within, or do more than report with a
  token that may only report;
- get a secret back out of the server: a token, a sealed key, the operator
  secret;
- make the server unusable for others from outside, without a token.

## What is known

- On a single machine, an agent running as your own user can read any token
  you keep in a file or in the environment. Tokens are a boundary between
  machines and between workspaces, not between you and an agent on your own
  laptop.
- Dev mode (`npm run dev`) turns review off and lets agents restart the
  server. It refuses to listen beyond the machine it runs on.
- What an agent reads in a repository or in the map is someone else's text.
  The agent that reads pushes is held to one repository and can only read
  it; its changes to the map are an agent's like any other.

## Supported versions

The `main` branch. There are no maintained older versions yet.
