import "@fontsource/spectral/300.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "@fontsource/spectral/600-italic.css";
import "./styles.css";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import { Ink, TextSize, INK_ROLES, type InkRole, type SizeRole } from "./marks";
import { newFileName, saveDocument, toFile, type DocSize } from "./storage";

const page = document.getElementById("page")!;
const caret = document.getElementById("caret")!;
const status = document.getElementById("status")!;

/* ------------------------------------------------------------------ editor */

const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [
    StarterKit.configure({
      // Quill never turns typed symbols into formatting, and keeps to the
      // minimum: paragraphs, bold, italic, strike-through and line breaks.
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      link: false,
      underline: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      strike: false,
    }),
    // Faded strike-through: struck words stay readable but step back.
    Strike.extend({
      addKeyboardShortcuts() {
        return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
      },
    }),
    Ink,
    TextSize,
  ],
  enableInputRules: false,
  enablePasteRules: false,
  autofocus: "end",
  editorProps: { attributes: { class: "ed", spellcheck: "true", "aria-label": "Page" } },
});

/* ------------------------------------------------------------ glow cursor */

let typingTimer: number | undefined;

function placeCaret() {
  const { view, state } = editor;
  if (!view.hasFocus() || !state.selection.empty) {
    caret.classList.remove("on");
    return;
  }
  const c = view.coordsAtPos(state.selection.head);
  const h = (c.bottom - c.top) * 0.82;
  caret.style.transform = `translate(${c.left}px, ${c.top + (c.bottom - c.top - h) / 2}px)`;
  caret.style.height = `${h}px`;
  caret.classList.add("on");
}

editor.on("selectionUpdate", placeCaret);
editor.on("transaction", () => requestAnimationFrame(placeCaret));
editor.on("focus", placeCaret);
editor.on("blur", () => caret.classList.remove("on"));
addEventListener("resize", placeCaret);
page.addEventListener("scroll", placeCaret, { passive: true });
document.fonts?.ready.then(placeCaret);

editor.view.dom.addEventListener("keydown", () => {
  document.body.classList.add("typing");
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => document.body.classList.remove("typing"), 600);
  float.classList.remove("on");
  hideShelf();
});

/* --------------------------------------------------------------- toolbars */

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";

const INK_LABEL: Record<InkRole, string> = {
  graphite: "Graphite",
  midnight: "Midnight",
  cobalt: "Cobalt",
  azure: "Azure",
  signal: "Signal red",
};

function bar(className: string, label: string) {
  const el = document.createElement("div");
  el.className = `tb ${className}`;
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", label);
  document.body.appendChild(el);
  const add = (html: string, title: string, run: () => void, key?: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    if (key) b.dataset.key = key;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    el.appendChild(b);
    return b;
  };
  const sep = () => el.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
  const tag = (t: string) => el.appendChild(Object.assign(document.createElement("span"), { className: "lbl", textContent: t }));
  return { el, add, sep, tag };
}

// Float: appears above a selection and formats only that selection.
const F = bar("float", "Format selection");
const float = F.el;
F.add("<b>B</b>", `Bold (${MOD}+B)`, () => editor.chain().focus().toggleBold().run(), "bold");
F.add("<i>I</i>", `Italic (${MOD}+I)`, () => editor.chain().focus().toggleItalic().run(), "italic");
F.add("<s>S</s>", `Strike-through (${MOD}+Shift+X)`, () => editor.chain().focus().toggleStrike().run(), "strike");
F.sep();
const SIZE_BTNS: [string, SizeRole | null, number][] = [
  ["Small", "small", 11],
  ["Body", null, 14],
  ["Large", "large", 17],
  ["Title", "title", 21],
];
for (const [name, role, px] of SIZE_BTNS) {
  F.add(`<span style="font-size:${px}px;line-height:1">A</span>`, name, () => {
    const c = editor.chain().focus();
    (role ? c.setTextSize(role) : c.unsetTextSize()).run();
  });
}
F.sep();
for (const role of INK_ROLES) {
  F.add(`<span class="sw" data-ink-swatch="${role}"></span>`, INK_LABEL[role], () => editor.chain().focus().setInk(role).run());
}
F.add('<span class="clear">×</span>', "Clear formatting", () => editor.chain().focus().unsetAllMarks().run());

function updateFloat() {
  const { state, view } = editor;
  if (state.selection.empty || !view.hasFocus()) {
    float.classList.remove("on");
    return;
  }
  hideShelf();
  for (const b of float.querySelectorAll<HTMLButtonElement>("button[data-key]")) {
    b.setAttribute("aria-pressed", String(editor.isActive(b.dataset.key!)));
  }
  const a = view.coordsAtPos(state.selection.from);
  const z = view.coordsAtPos(state.selection.to);
  const w = float.offsetWidth;
  const h = float.offsetHeight;
  const mid = (Math.min(a.left, z.left) + Math.max(a.right, z.right)) / 2;
  const left = Math.max(8, Math.min(mid - w / 2, innerWidth - w - 8));
  let top = a.top - h - 10;
  if (top < 8) top = z.bottom + 10;
  float.style.transform = `translate(${left}px, ${top}px)`;
  float.classList.add("on");
}
editor.on("selectionUpdate", updateFloat);
editor.on("blur", () => float.classList.remove("on"));

// Shelf: rises from the bottom edge only when the mouse reaches it, with
// nothing selected. Sizes apply to the whole document; the rest to the next words.
const S = bar("shelf", "Document");
const shelf = S.el;
S.tag("Document");
const DOC_SIZES: [string, DocSize][] = [
  ["Small", "small"],
  ["Body", "body"],
  ["Large", "large"],
];
const docSizeBtns = DOC_SIZES.map(([name, size]) =>
  S.add(name, `Whole document: ${name}`, () => {
    setDocSize(size);
    scheduleSave();
  }, undefined),
);
S.sep();
S.tag("Next words");
S.add("<b>B</b>", "Bold for what you type next", () => editor.chain().focus().toggleBold().run());
S.add("<i>I</i>", "Italic for what you type next", () => editor.chain().focus().toggleItalic().run());
for (const role of INK_ROLES) {
  S.add(`<span class="sw" data-ink-swatch="${role}"></span>`, `${INK_LABEL[role]} for what you type next`, () =>
    editor.chain().focus().setInk(role).run(),
  );
}

let docSize: DocSize = "body";
function setDocSize(size: DocSize) {
  docSize = size;
  document.body.dataset.size = size;
  docSizeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(DOC_SIZES[i][1] === size)));
  setTimeout(placeCaret, 260);
}
setDocSize("body");

let shelfTimer: number | undefined;
function hideShelf() {
  clearTimeout(shelfTimer);
  shelf.classList.remove("on");
}
addEventListener("mousemove", (e) => {
  const nearBottom = e.clientY > innerHeight - 56;
  if (nearBottom && editor.state.selection.empty) {
    clearTimeout(shelfTimer);
    shelf.classList.add("on");
  } else if (shelf.classList.contains("on") && !shelf.matches(":hover")) {
    clearTimeout(shelfTimer);
    shelfTimer = window.setTimeout(() => shelf.classList.remove("on"), 350);
  }
});
document.documentElement.addEventListener("mouseleave", () => {
  clearTimeout(shelfTimer);
  shelfTimer = window.setTimeout(() => shelf.classList.remove("on"), 400);
});

/* ---------------------------------------------------------------- autosave */

let fileName = newFileName();
let saveTimer: number | undefined;
let saved = true;

function titleOf(): string {
  const first = editor.state.doc.firstChild?.textContent.trim() ?? "";
  return first.slice(0, 80) || "Untitled";
}

function scheduleSave() {
  saved = false;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 700);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (saved) return;
  if (editor.isEmpty) {
    saved = true; // nothing worth keeping yet: no empty files in the library
    return;
  }
  try {
    await saveDocument(fileName, toFile(titleOf(), docSize, editor.getHTML()));
    saved = true;
    flash("Saved");
  } catch (err) {
    console.error(err);
    flash("Couldn't save. Your text is still here; Quill will try again as you type.");
  }
}

let flashTimer: number | undefined;
function flash(text: string) {
  status.textContent = text;
  status.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => status.classList.remove("on"), 1400);
}

editor.on("update", scheduleSave);
addEventListener("beforeunload", () => void saveNow());

/* --------------------------------------------------------------- new page */

async function newPage() {
  await saveNow();
  fileName = newFileName();
  editor.commands.clearContent(true);
  saved = true;
  setDocSize("body");
  editor.commands.focus("start");
}

addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "n") {
    e.preventDefault();
    void newPage();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault(); // saving is automatic; Ctrl+S just saves right now
    void saveNow();
  }
});

// Clicking anywhere on the page (even the empty margin) puts you back in the text.
page.addEventListener("mousedown", (e) => {
  if (e.target === page) {
    e.preventDefault();
    editor.commands.focus("end");
  }
});
