# types

The types broker ([spec/types.md](../../spec/types.md)): provides
`types.define`, `types.read`, `types.mark` and `types.acyclic` (edition
11: kinds of link held acyclic, each while any plugin holds it). It holds bases, flavours and kinds of link
as the defining plugins' effects, and defines none itself.

- A taken name is refused, never replaced.
- A flavour is refused if its base isn't defined now, if it brings
  statuses, or if it declares a field its base already has.
- A flavour whose base's plugin unloads leaves `types.read` with it, and
  comes back when the base does.
- `all()` lists in config-tree order of the defining plugins.
