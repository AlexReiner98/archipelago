# The guide

What a new person reads, in order. The app's Guide view reads this file
for its order, then shows each chapter, then every pack's own README. Each
is a file in this repository, so the guide is always the code's own.

## The path

1. [What Archipelago is](../README.md)
2. [First run](first-run.md)
3. [Concepts](concepts.md)
4. [Writing a pack](writing-a-pack.md)
5. [Profiles and the harness](profiles-and-the-harness.md)
6. [The spec](../spec/README.md)

## Then the spec and every pack

After the path come the spec's contracts, one doc each, in the order
[the spec](../spec/README.md) lists them. Then each folder in
[packs/](../packs/) has a README: what the pack is for, what it adds, and
its rules. Each one opens its page in the Packs view, where the same pack
is read as it runs.

## Writing a chapter

- One file per chapter, here, linked from the list above.
- Short sections under `##` headings: the Guide folds each one.
- Links are relative to the file, and a test checks that each one
  resolves, a heading included.
