# shell

The page's entry, `app.js`: it starts the page once every root's page has loaded and routes an address to the root
that draws it. The last root, so it imports every root before it in order (`packs/roots.json`). It sets what the kit
asks for by name: the part runtime (`hooks.partsRuntime`) and the password page (`hooks.passwordPage`).
