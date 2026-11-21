# renderer

Preact in the page, and the slot broker ([spec](../../spec/slot.md)).
Provides `slot.declare`, `slot.fill`, `slot.read` (with the shared `Slot`);
declares `root` and the six regions ([frame](../../spec/frame.md)), and mounts
the fill of `root` at `config.mount` (`#app`). Injects `here.read` for each
fill's `when`. `config.arrange` (`pack/name` to a region, a slot or `"off"`)
moves or hides fills. The page's import map names the one copy
of `preact`, `preact/hooks` and `htm` every pack imports. Unloading it
unmounts everything.
