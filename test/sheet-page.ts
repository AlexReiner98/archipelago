// What a browser test reads of an item's page, now that the sheet root's walled part draws it (packs/sheet/parts/page,
// task e_zhxd9bhb): its marks by their keys, inside the part's body. One place for the selectors, as the panes tests
// keep theirs (./tab-page.ts), so a change to what the part draws is one change here.

/** The page part's body, drawn in the sheet. */
export const PAGE = `#sheet [data-part-id="sheet.page"]`;

/** A mark of the page part by its key: `walk` (Walk from it), `link-start` (Link), `section:history`... An input carries no key on the page. */
export const mark = (key: string) => `${PAGE} [data-key="${key}"]`;

/** An expression: the page's title, as written in its title's box or read where it may not be written. */
export const title = `(document.querySelector('${PAGE} input.pm-input-title')?.value ?? document.querySelector('${PAGE} .pm-text')?.textContent ?? '')`;

/** An expression: whether the page part draws the mark with this key. */
export const has = (key: string) => `Boolean(document.querySelector('${mark(key)}'))`;

/** A statement: press the mark with this key. */
export const press = (key: string) => `document.querySelector('${mark(key)}').click()`;

/** A statement: press the item of the part's own menu (⋯) that says these words. */
export const pressMenu = (words: string) => `[...document.querySelectorAll('${PAGE} .menu-items button')].find((b) => b.textContent === ${JSON.stringify(words)}).click()`;

/** An expression: the words the page part shows. */
export const text = `(document.querySelector('${PAGE}')?.innerText ?? '')`;
