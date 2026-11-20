# renderer

Preact in the page, and the slot broker ([spec](../../spec/slot.md)).
Provides `slot.declare`, `slot.fill`, `slot.read`; declares `root` and mounts
its fill at `config.mount` (`#app`). The page's import map names the one copy
of `preact`, `preact/hooks` and `htm` every pack imports. Unloading it
unmounts everything.
