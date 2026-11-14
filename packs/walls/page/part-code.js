// Code written in a part's input of kind `code` (task e_pbdxaxdy): the host's code editor, CodeMirror 6 kept as one
// vendored file (./codemirror.min.js, served as /codemirror.js, the owner's yes of 14 Nov 2026), loaded only when one
// is drawn. It has line numbers, search, undo and the colours of JavaScript or CSS (`lang`); every colour, face and
// length is the style's, its variables read by name (`look`), none of its own. It stands in a shadow root of its own:
// there CodeMirror keeps its rules in a constructed sheet, which the page's policy lets in, where a <style> it would
// write into the page is refused (style-src 'self'). What is typed goes back to the part as `edit` (its whole text),
// Mod-s as `submit`, as a box of words does.
//
// Code that carries `preview` ({ item, field }) is tried as it is written: at each pause the text goes out as a try
// (`preview` in the host's hands, packs/surface/kernel/tool-preview.ts), drawn on the person's own canvas in place of what the map
// holds; back to what it was opened with, or the editor gone from the page (folded, saved, the sheet closed), the try
// is dropped. Nobody else sees a try, and nothing of it is logged.

let loading;
/** CodeMirror, loaded once, the first time code is drawn. */
const codemirror = () => (loading ??= import('./codemirror.js'));

/** How long, in milliseconds, the typing stops before what is written is tried. */
const pause = 600;

/** A variable of the page's style, by its name. */
const v = (name) => `var(--${name})`;

/** The editor's colours for what each piece of code is, each a colour the style names. */
function colours(cm) {
  const t = cm.tags;
  return cm.HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: v('g-system') },
    { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: v('ok') },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: v('warn') },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('muted'), fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.definition(t.function(t.variableName))], color: v('g-actor') },
    { tag: [t.typeName, t.className, t.tagName, t.propertyName, t.attributeName], color: v('g-aim') },
    { tag: [t.invalid], color: v('bad') },
  ]);
}

/** How the editor looks: the style's colours, faces and lengths, by name. */
const look = (cm) => cm.EditorView.theme({
  '&': { color: v('text'), backgroundColor: v('panel'), border: `${v('border-1')} solid ${v('line')}`, borderRadius: v('radius-2'), fontSize: v('text-3') },
  '&.cm-focused': { outline: 'none', borderColor: v('accent') },
  '.cm-scroller': { fontFamily: v('face-mono'), lineHeight: '1.5', maxHeight: v('code-open') },
  '.cm-gutters': { backgroundColor: v('panel'), color: v('muted'), borderRight: `${v('border-1')} solid ${v('line')}` },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: v('closed-soft') },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: v('text') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: v('accent-soft') },
  '.cm-searchMatch': { backgroundColor: v('warn-soft') },
  '.cm-searchMatch.cm-searchMatch-selected, .cm-selectionMatch': { backgroundColor: v('accent-soft') },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: v('ok-soft') },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: v('bad-soft') },
  '.cm-foldPlaceholder': { backgroundColor: v('closed-soft'), color: v('muted'), border: 'none' },
  '.cm-panels': { backgroundColor: v('panel'), color: v('text'), borderColor: v('line') },
  '.cm-panel.cm-search': { padding: `${v('space-3')} ${v('space-4')}`, fontFamily: v('face-text') },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { font: 'inherit', color: v('text') },
  '.cm-textfield, .cm-button': { backgroundColor: v('bg'), backgroundImage: 'none', border: `${v('border-1')} solid ${v('line')}`, borderRadius: v('radius-1') },
  '.cm-panel.cm-search [name=close]': { color: v('muted') },
}, { dark: matchMedia('(prefers-color-scheme: dark)').matches });

/**
 * The element a code input is drawn in. `said(name, value)` tells the part (`edit` with the text, `submit`);
 * `preview(at, text)` tries the text as the code of `at` ({ item, field }), null drops the try (absent where the part
 * may not write). Answers with the element; `codeText`, `codeSet` and `codeAt` read and move it.
 */
export function codeField(node, { said, preview }) {
  const el = document.createElement('div');
  el.className = 'pm-input';
  el.dataset.code = node.at.lang ?? 'js';
  el.dataset.loading = '';
  const root = el.attachShadow({ mode: 'open' });
  let at = node.at, opened = at.value ?? '', text = opened, view = null, timer = 0, tried = false;
  const tryNow = () => {
    timer = 0;
    if (!preview || !at.preview) return;
    if (text === opened) return void (tried && ((tried = false), preview(at.preview, null)));
    tried = true;
    preview(at.preview, text);
  };
  // What is typed goes to the part as it is typed, the whole text, as a box of words does; the try waits for a pause.
  const typed = (now) => {
    text = now;
    said('edit', text);
    clearTimeout(timer);
    timer = setTimeout(tryNow, pause);
  };
  // Gone from the page, once it was on it, its try goes with it.
  let shown = false;
  const watch = new MutationObserver(() => {
    if (el.isConnected) return void (shown = true);
    if (!shown) return;
    watch.disconnect();
    clearTimeout(timer);
    if (tried && preview && at.preview) preview(at.preview, null);
    view?.destroy();
  });
  queueMicrotask(() => watch.observe(document.body, { childList: true, subtree: true }));
  el.codeState = {
    get text() { return text; },
    // The part says what it holds (opened again as it is now, or saved): a try is of what changes from here.
    set(value) {
      text = opened = value;
      clearTimeout(timer);
      if (tried && preview && at.preview) ((tried = false), preview(at.preview, null));
      if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    at(next) { at = next; },
  };
  codemirror().then((cm) => {
    const language = at.lang === 'css' ? cm.cssLanguage : cm.javascriptLanguage;
    view = new cm.EditorView({
      parent: root,
      root,
      state: cm.EditorState.create({
        doc: text,
        extensions: [
          cm.lineNumbers(), cm.highlightActiveLineGutter(), cm.highlightSpecialChars(), cm.history(), cm.foldGutter(), cm.drawSelection(),
          cm.indentOnInput(), cm.bracketMatching(), cm.highlightActiveLine(), cm.highlightSelectionMatches(), cm.search({ top: true }),
          cm.indentUnit.of('  '), cm.EditorState.tabSize.of(2), cm.syntaxHighlighting(colours(cm)), look(cm), language,
          cm.keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (said('submit'), true) }, ...cm.defaultKeymap, ...cm.historyKeymap, ...cm.searchKeymap, ...cm.foldKeymap, cm.indentWithTab]),
          cm.EditorView.updateListener.of((u) => u.docChanged && typed(u.state.doc.toString())),
          cm.EditorView.contentAttributes.of({ 'aria-label': at.label ?? at.tip ?? 'Code' }),
        ],
      }),
    });
    delete el.dataset.loading;
  }, (err) => {
    root.textContent = `The code editor did not load: ${String(err?.message ?? err).slice(0, 200)}`;
    el.dataset.failed = '';
  });
  // Escape in the editor's search closes the search, not the sheet.
  el.addEventListener('keydown', (e) => e.key === 'Escape' && root.querySelector('.cm-search') && e.stopPropagation());
  return el;
}

/** What a code input holds now. */
export const codeText = (el) => el.codeState?.text ?? '';
/** Set what a code input holds, as the part says it. */
export const codeSet = (el, value) => el.codeState?.set(value);
/** Hand a code input its mark again: what it is tried as, and its language. */
export const codeAt = (el, at) => el.codeState?.at(at);
