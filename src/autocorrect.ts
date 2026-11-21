/// <reference types="vite/client" />
/**
 * Autocorrect for lazy typing.
 *
 * When a word is finished (a space, punctuation or Enter), Quill looks at it
 * once and, if needed, swaps it for the fixed word in the same keystroke, so
 * the correction lands as you type. The fixed word gets a faint cobalt
 * underline that fades in about a second.
 *
 * Changed your mind? Press Ctrl+Z straight after a correction and the word
 * goes back to how you typed it. Quill then leaves that word alone from now on.
 * (Backspace stays an ordinary Backspace, so you can still back over the
 * space to add a comma.)
 *
 * It's on unless switched off in the top shelf. The setting is shared by the
 * main window and quick capture.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { correct, correctPrevious, loadWords, loadPairs, setLeaveAlone, wordAtEnd, wordsLoaded, wordCount } from "./autocorrect-engine";
// The word list ships inside the app (no download, no separate file to find).
import WORDS from "./autocorrect-words.txt?raw";
import PAIRS from "./autocorrect-pairs.txt?raw";

/* ------------------------------------------------------------ the setting */

const PREF = "quill:pref:autocorrect";
const KEEP = "quill:autocorrect:leave-alone";

export function autocorrectOn(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}

export function setAutocorrect(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    /* it stays as it was */
  }
}

function readLeaveAlone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEEP) ?? "[]");
    return Array.isArray(v) ? v.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function rememberLeaveAlone(word: string) {
  const all = new Set(readLeaveAlone());
  all.add(word.toLowerCase());
  setLeaveAlone(all);
  try {
    localStorage.setItem(KEEP, JSON.stringify([...all]));
  } catch {
    /* remembered for this session only */
  }
}

// The other window may have added a word: pick it up.
window.addEventListener("storage", (e) => {
  if (e.key === KEEP) setLeaveAlone(readLeaveAlone());
});
setLeaveAlone(readLeaveAlone());

/** Read the word list (about 0.1s), in a quiet moment after start-up. */
function loadDictionary() {
  if (wordsLoaded()) return;
  try {
    loadWords(WORDS);
    // Word pairs (for context) in a second quiet moment, so start-up stays smooth.
    setTimeout(() => loadPairs(PAIRS), 300);
  } catch (e) {
    console.error("Autocorrect: couldn't read the word list", e);
  }
}

/** For the top shelf's note: how many words autocorrect knows. */
export function autocorrectWords(): number {
  loadDictionary();
  return wordCount();
}

/* ------------------------------------------------------------ the plugin */

interface Last {
  from: number; // where the corrected word starts
  typed: string; // what was typed
  fixed: string; // what it became
  ender: string; // the key that finished it
  capitalOnly: boolean;
}

interface AcState {
  last: Last | null;
  marks: DecorationSet;
}

const key = new PluginKey<AcState>("quillAutocorrect");
const CUE_MS = 1100;

const isEnder = (t: string) => /^[\s.,;:!?)\]}"”]$/u.test(t);

/** Fix the word before `pos`, then type `ender`. Returns false if there was nothing to fix. */
function fixBefore(view: EditorView, pos: number, ender: string): boolean {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  const text = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "\n");
  const found = wordAtEnd(text);
  if (!found) return false;
  loadDictionary(); // normally done already; if not, now
  const before = text.slice(0, found.start);
  const fix = correct(before, found.word, ender);
  // The word before may only now give itself away: "its been", "gong to".
  const prevM = /([\p{L}'’]+)( +)$/u.exec(before);
  const prevFix = prevM ? correctPrevious(before.slice(0, prevM.index), prevM[1], fix?.text ?? found.word) : null;
  if (!fix && !prevFix) return false;

  const from = $pos.start() + found.start;
  const to = pos;
  // Keep each word's own look (bold, colour, size) and type the ender in the
  // style the next words are set to, exactly as a normal keystroke would.
  const nextMarks = state.storedMarks ?? $pos.marks();
  const tr = state.tr;
  const word = fix?.text ?? found.word;
  if (fix) tr.replaceWith(from, to, state.schema.text(fix.text, state.doc.nodeAt(from)?.marks ?? []));
  let end = from + word.length;
  if (ender) {
    tr.insert(end, state.schema.text(ender, nextMarks));
    end += ender.length;
  }
  let shift = 0;
  if (prevFix && prevM) {
    // Earlier in the line, so the positions above aren't affected until we add the shift.
    const pFrom = $pos.start() + prevM.index;
    const pTo = pFrom + prevM[1].length;
    tr.replaceWith(pFrom, pTo, state.schema.text(prevFix, state.doc.nodeAt(pFrom)?.marks ?? []));
    shift = prevFix.length - prevM[1].length;
  }
  end += shift;
  tr.setSelection(TextSelection.create(tr.doc, end));
  const pStart = prevM ? $pos.start() + prevM.index : 0;
  tr.setMeta(
    key,
    fix
      ? ({ from: from + shift, typed: found.word, fixed: fix.text, ender, capitalOnly: fix.capitalOnly } satisfies Last)
      : // Only the earlier word changed: show its cue (Ctrl+Z works through the usual undo).
        ({ from: pStart, typed: prevM![1], fixed: prevFix!, ender: "\u0000", capitalOnly: false } satisfies Last),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Z straight after a correction puts the typed word back. */
function undoFix(view: EditorView): boolean {
  const { state } = view;
  const last = key.getState(state)?.last;
  if (!last || !state.selection.empty) return false;
  const end = last.from + last.fixed.length;
  if (state.selection.head !== end + last.ender.length) return false;
  if (state.doc.textBetween(last.from, end + last.ender.length) !== last.fixed + last.ender) return false;
  const marks = state.doc.nodeAt(last.from)?.marks ?? [];
  const tr = state.tr.replaceWith(last.from, end, state.schema.text(last.typed, marks));
  tr.setSelection(TextSelection.create(tr.doc, last.from + last.typed.length + last.ender.length));
  tr.setMeta(key, null);
  view.dispatch(tr);
  if (!last.capitalOnly) rememberLeaveAlone(last.typed);
  return true;
}

export const Autocorrect = Extension.create({
  name: "autocorrect",
  // Before lists, pictures and the capture window's own keys.
  priority: 1000,

  onCreate() {
    const idle = (window as Window & { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
    if (idle) idle(loadDictionary);
    else setTimeout(loadDictionary, 400);
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { view, state } = this.editor;
        if (autocorrectOn() && state.selection.empty) fixBefore(view, state.selection.head, "");
        return false; // carry on with the new line as usual
      },
      "Mod-z": () => undoFix(this.editor.view),
    };
  },

  addProseMirrorPlugins() {
    let cueTimer: number | undefined;
    return [
      new Plugin<AcState>({
        key,
        state: {
          init: () => ({ last: null, marks: DecorationSet.empty }),
          apply(tr: Transaction, value: AcState, _old: EditorState, state: EditorState): AcState {
            const meta = tr.getMeta(key) as Last | null | "fade" | undefined;
            if (meta === "fade") return { ...value, marks: DecorationSet.empty };
            if (meta === null) return { last: null, marks: DecorationSet.empty };
            if (meta) {
              const cue = Decoration.inline(meta.from, meta.from + meta.fixed.length, { class: "ac-fix" });
              return { last: meta, marks: DecorationSet.create(state.doc, [cue]) };
            }
            if (!tr.docChanged) return value;
            // Any other edit ends the chance to undo; the cue moves with the text.
            return { last: null, marks: value.marks.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.marks,
          handleTextInput(view, from, to, text) {
            if (from !== to || !isEnder(text) || !autocorrectOn()) return false;
            if (view.composing) return false;
            // A second space in a row (a slip of the thumb) is dropped, except
            // at the start of a line, where it might be lining something up.
            if (text === " ") {
              const $f = view.state.doc.resolve(from);
              const prev = $f.parent.textBetween(Math.max(0, $f.parentOffset - 1), $f.parentOffset, undefined, "\n");
              if (prev === " " && $f.parentOffset > 1) return true;
            }
            return fixBefore(view, from, text);
          },
        },
        view: () => ({
          update(view, prev) {
            const now = key.getState(view.state);
            // A new correction: fade its cue after a moment.
            if (now?.last && now.last !== key.getState(prev)?.last) {
              clearTimeout(cueTimer);
              cueTimer = window.setTimeout(() => {
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, "fade").setMeta("addToHistory", false));
              }, CUE_MS);
            }
          },
          destroy: () => clearTimeout(cueTimer),
        }),
      }),
    ];
  },
});

/** Fix the word just before the cursor now (quick capture calls this before saving on Enter). */
export function autocorrectNow(editor: Editor) {
  const { view, state } = editor;
  if (autocorrectOn() && state.selection.empty) fixBefore(view, state.selection.head, "");
}
