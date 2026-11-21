# shell

The minimal shell: fills `root` with one header line and one slot,
`shell.main` (`many`), where views go. One view shows at a time: the header
has a tab for each fill (its `title`), and the URL's hash, the filling
pack's id (`#map`, `#harness`), says which. It keeps no colours: its sheet
refers to the style tokens (spec/style.md), so it reads with or without
the style pack.
