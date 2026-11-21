/**
 * "Next words": the style Quill types in, set from the Shelf.
 *
 * Float changes only the words you highlighted. Whatever you type afterwards
 * is written in these defaults instead, wherever the cursor is, so a size or
 * colour picked for one phrase never leaks into the next sentence.
 *
 * It works through ProseMirror's stored marks: after every change with an
 * empty selection, the stored marks are reset to the defaults, so the next
 * character typed takes exactly the default style. Pressing Ctrl+B, Ctrl+I
 * or Ctrl+Shift+X with nothing selected changes the defaults themselves.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Mark, Schema } from "@tiptap/pm/model";
import type { InkRole, SizeRole } from "./marks";

export interface TypingStyle {
  size: SizeRole | null; // null = Body
  ink: InkRole | null; // null = Graphite
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

export const PLAIN: TypingStyle = { size: null, ink: null, bold: false, italic: false, strike: false };

export const typingKey = new PluginKey<TypingStyle>("quillTyping");
const INTERNAL = "quillTypingInternal";

function marksFor(schema: Schema, s: TypingStyle): Mark[] {
  const m: Mark[] = [];
  if (s.bold) m.push(schema.marks.bold.create());
  if (s.italic) m.push(schema.marks.italic.create());
  if (s.strike) m.push(schema.marks.strike.create());
  if (s.ink && s.ink !== "graphite") m.push(schema.marks.ink.create({ role: s.ink }));
  if (s.size) m.push(schema.marks.textSize.create({ size: s.size }));
  return m;
}

function styleFrom(marks: readonly Mark[]): TypingStyle {
  const find = (name: string) => marks.find((m) => m.type.name === name);
  return {
    size: (find("textSize")?.attrs.size as SizeRole | undefined) ?? null,
    ink: (find("ink")?.attrs.role as InkRole | undefined) ?? null,
    bold: !!find("bold"),
    italic: !!find("italic"),
    strike: !!find("strike"),
  };
}

const sameMarks = (a: readonly Mark[] | null, b: readonly Mark[]) =>
  !!a && a.length === b.length && a.every((m) => b.some((n) => n.eq(m)));

export const sameStyle = (a: TypingStyle, b: TypingStyle) =>
  a.size === b.size && a.ink === b.ink && a.bold === b.bold && a.italic === b.italic && a.strike === b.strike;

export const typingStyle = (state: EditorState) => typingKey.getState(state) ?? PLAIN;

/** A transaction that makes `style` the defaults. */
export function setTypingStyle(state: EditorState, style: TypingStyle): Transaction {
  const tr = state.tr.setMeta(typingKey, style).setMeta(INTERNAL, true).setMeta("addToHistory", false);
  if (state.selection.empty) tr.setStoredMarks(marksFor(state.schema, style));
  return tr;
}

export const Typing = Extension.create({
  name: "typing",
  addProseMirrorPlugins() {
    return [
      new Plugin<TypingStyle>({
        key: typingKey,
        state: {
          init: () => PLAIN,
          apply: (tr, value) => (tr.getMeta(typingKey) as TypingStyle | undefined) ?? value,
        },
        appendTransaction(trs, _old, state) {
          if (!state.selection.empty) return null;
          let style = typingStyle(state);
          // A keyboard shortcut toggled a style with nothing selected: that
          // becomes the new default for what comes next.
          const explicit = trs.some((t) => t.storedMarksSet && !t.docChanged && !t.getMeta(INTERNAL));
          if (explicit) {
            style = styleFrom(state.storedMarks ?? []);
            return setTypingStyle(state, style);
          }
          const want = marksFor(state.schema, style);
          if (sameMarks(state.storedMarks, want)) return null;
          return state.tr.setStoredMarks(want).setMeta(INTERNAL, true).setMeta("addToHistory", false);
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------ saving with the document */

/** "size=large;ink=cobalt;bold" — stored in the file's quill-next meta tag. */
export function styleToText(s: TypingStyle): string {
  return [s.size && `size=${s.size}`, s.ink && `ink=${s.ink}`, s.bold && "bold", s.italic && "italic", s.strike && "strike"]
    .filter(Boolean)
    .join(";");
}

export function styleFromText(text: string, sizes: readonly string[], inks: readonly string[]): TypingStyle {
  const parts = text.split(";").map((p) => p.trim());
  const val = (k: string) => parts.find((p) => p.startsWith(k + "="))?.slice(k.length + 1) ?? "";
  const size = val("size");
  const ink = val("ink");
  return {
    size: sizes.includes(size) ? (size as SizeRole) : null,
    ink: inks.includes(ink) && ink !== "graphite" ? (ink as InkRole) : null,
    bold: parts.includes("bold"),
    italic: parts.includes("italic"),
    strike: parts.includes("strike"),
  };
}
