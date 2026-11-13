// Find as the find pack's part draws it on the page (task e_rfjwstnu), for the browser tests that drive it: each a
// script to evaluate in the page. The part answers with marks the host draws (packs/walls/page/part-render.js): its
// choices a list of rows, each a box of its kind, a button of its name and muted words (what it is, how many); its
// field an input; whether find is open, page state on the root (`data-find_open`).

/** The field. */
export const input = `document.querySelector('#find .find-part input')`;
/** The list of choices, while find draws one. */
export const list = `document.querySelector('#find .find-part .pm-list')`;
/** The choices drawn, each a row's box. */
export const choices = `[...(${list}?.querySelectorAll('.pm-row > .pm-box') ?? [])]`;
/** What a choice (a script naming one as `c`) says: its kind, its name, its words after (what it is, its count), whether lit. */
export const said = (c: string) => `((c) => c && { kind: c.querySelector(':scope > .pm-text')?.textContent ?? '', name: c.querySelector('.pm-button')?.textContent ?? '', notes: [...c.querySelectorAll(':scope > .pm-text')].slice(1).map((t) => t.textContent), lit: c.classList.contains('pm-tone-accent') })(${c})`;
/** Every choice drawn, as `said` says it. */
export const saidAll = `${choices}.map((c) => ${said('c')})`;
/** Whether the choices are in sight. */
export const shown = `Boolean(${list}) && getComputedStyle(${list}).display !== 'none' && ${choices}.length > 0`;
/** Whether find is open. */
export const isOpen = `document.documentElement.dataset.find_open === '1'`;
/** The part find is in (Find, Only...), its word before the field while it is open. */
export const mode = `(document.querySelector('#find .find-part .part-body > .pm-box > .pm-box:last-child > .pm-text')?.textContent ?? '')`;
/** The choice of this kind and name, or nothing. */
export const choice = (kind: string, name: string) => `${choices}.find((c) => c.querySelector(':scope > .pm-text')?.textContent === ${JSON.stringify(kind)} && c.querySelector('.pm-button')?.textContent === ${JSON.stringify(name)})`;
/** Press that choice's name, once it is there: true when it was. */
export const press = (kind: string, name: string) => `(() => { const c = ${choice(kind, name)}; c?.querySelector('.pm-button').click(); return Boolean(c); })()`;
/** Type in find as a person does: the field in focus, then the words. */
export const type = (q: string) => `(() => { const i = ${input}; i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
/** A key pressed in the field: Enter (with Shift held, to add), an arrow, Escape. */
export const key = (k: string, shift = false) => `${input}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`;
