# The guide

What a new person reads, in order. The app's Guide view reads this file
for its order, then shows each chapter, then every plugin's own README. Each
is a file in this repository, so the guide is always the code's own.

## The path

1. [What Archipelago is](../README.md)
2. [First run](first-run.md)
3. [Concepts](concepts.md)
4. [Writing a plugin](writing-a-plugin.md)
5. [The spec](../spec/README.md)

The learning loop (profiles, verdicts and the Context interface) is a plugin
folder of its own, `archipelago-loop`, with its own chapter.

## Then the spec and every plugin

After the path come the spec's contracts, one doc each, in the order
[the spec](../spec/README.md) lists them. Then each folder in
[plugins/](../plugins/) has a README: what the plugin is for, what it adds, and
its rules. Each one opens its page in the Plugins view, where the same plugin
is read as it runs.

## Writing a chapter

- One file per chapter, here, linked from the list above.
- Short sections under `##` headings: the Guide folds each one.
- Links are relative to the file, and a test checks that each one
  resolves, a heading included.
