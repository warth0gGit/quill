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
import { Pages, PageController, PAGE_H, GAP } from "./pages";
import { newFileName, saveDocument, toFile, type DocSize, type Spacing } from "./storage";
import { bar, icons, MOD } from "./ui";
import * as os from "./platform";

const page = document.getElementById("page")!;
const sheetLayer = document.getElementById("sheet-layer")!;
const caret = document.getElementById("caret")!;
const status = document.getElementById("status")!;

const pref = {
  get: (k: string) => {
    try {
      return localStorage.getItem("quill:pref:" + k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem("quill:pref:" + k, v);
    } catch {
      /* preferences are a convenience; carry on without them */
    }
  },
};

/* ------------------------------------------------------------------ editor */

const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [
    StarterKit.configure({
      // Quill never turns typed symbols into formatting. It keeps to
      // paragraphs, lists, bold, italic, strike-through and line breaks.
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      link: false,
      underline: false,
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
    Pages,
  ],
  enableInputRules: false,
  enablePasteRules: false,
  autofocus: "end",
  editorProps: {
    attributes: { class: "ed", spellcheck: "true", "aria-label": "Page" },
    // Keep the line you're writing well clear of the window's edges.
    scrollThreshold: { top: 80, bottom: 160, left: 0, right: 0 },
    scrollMargin: { top: 80, bottom: 160, left: 0, right: 0 },
  },
});

/* ------------------------------------------------------------ glow cursor */
// Cobalt, 2.5px wide, 75% of the line, a 5px glow at 30%, breathing every
// 2.8s, hopping to each new position in 170ms. It sits 1.5px clear of the
// letter before it, so it never touches the text.

const CARET_GAP = 1.5;
const CARET_HEIGHT = 0.75;
let typingTimer: number | undefined;

function placeCaret() {
  const { view, state } = editor;
  if (!view.hasFocus() || !state.selection.empty) {
    caret.classList.remove("on");
    return;
  }
  const c = view.coordsAtPos(state.selection.head);
  const lineH = c.bottom - c.top;
  const h = lineH * CARET_HEIGHT;
  caret.style.transform = `translate(${c.left + CARET_GAP}px, ${c.top + (lineH - h) / 2}px)`;
  caret.style.height = `${h}px`;
  caret.classList.add("on");
}

// While the page scrolls, the cursor moves with the text instead of hopping.
let scrollTimer: number | undefined;
page.addEventListener(
  "scroll",
  () => {
    caret.classList.add("still");
    placeCaret();
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => caret.classList.remove("still"), 120);
  },
  { passive: true },
);

editor.on("selectionUpdate", placeCaret);
editor.on("transaction", () => requestAnimationFrame(placeCaret));
editor.on("focus", placeCaret);
editor.on("blur", () => caret.classList.remove("on"));

editor.view.dom.addEventListener("keydown", (e) => {
  if (e.key === "Alt") return; // Alt alone toggles the top shelf (below)
  document.body.classList.add("typing");
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => document.body.classList.remove("typing"), 600);
  float.classList.remove("on");
  hideShelves();
});

/* ------------------------------------------------------------------ pages */

const pages = new PageController(
  () => editor.view,
  (count) => {
    sheetLayer.replaceChildren(
      ...Array.from({ length: pages.enabled ? count : 0 }, (_, i) => {
        const s = document.createElement("div");
        s.className = "sheet";
        s.style.top = `${i * (PAGE_H + GAP)}px`;
        return s;
      }),
    );
    (editor.view.dom as HTMLElement).style.minHeight = pages.enabled ? `${count * PAGE_H + (count - 1) * GAP}px` : "";
    requestAnimationFrame(placeCaret);
  },
);

function setPages(on: boolean) {
  document.body.classList.toggle("pages", on);
  pref.set("pages", on ? "on" : "off");
  pagesBtn.setAttribute("aria-pressed", String(on));
  pages.setEnabled(on);
  placeCaret();
}

editor.on("update", () => pages.enabled && pages.schedule());
os.onResized(() => {
  if (pages.enabled) pages.schedule(60);
  placeCaret();
});

/* ------------------------------------------------------------ Float */

const INK_LABEL: Record<InkRole, string> = {
  graphite: "Graphite",
  midnight: "Midnight",
  cobalt: "Cobalt",
  azure: "Azure",
  signal: "Signal red",
};

const F = bar("float", "Format selection");
const float = F.el;
const marked: [HTMLButtonElement, string][] = [];
marked.push([F.button("<b>B</b>", `Bold (${MOD}+B)`, () => editor.chain().focus().toggleBold().run()), "bold"]);
marked.push([F.button("<i>I</i>", `Italic (${MOD}+I)`, () => editor.chain().focus().toggleItalic().run()), "italic"]);
marked.push([F.button("<s>S</s>", `Strike-through (${MOD}+Shift+X)`, () => editor.chain().focus().toggleStrike().run()), "strike"]);
F.sep();
const SIZE_BTNS: [string, SizeRole | null, number][] = [
  ["Small", "small", 11],
  ["Body", null, 14],
  ["Large", "large", 17],
  ["Title", "title", 21],
];
for (const [name, role, px] of SIZE_BTNS) {
  F.button(`<span style="font-size:${px}px;line-height:1">A</span>`, name, () => {
    const c = editor.chain().focus();
    (role ? c.setTextSize(role) : c.unsetTextSize()).run();
  });
}
F.sep();
for (const role of INK_ROLES) {
  F.button(`<span class="sw" data-ink-swatch="${role}"></span>`, INK_LABEL[role], () => editor.chain().focus().setInk(role).run());
}
F.button('<span class="clear">×</span>', "Clear formatting", () => editor.chain().focus().unsetAllMarks().run());

function updateFloat() {
  const { state, view } = editor;
  if (state.selection.empty || !view.hasFocus()) {
    float.classList.remove("on");
    return;
  }
  hideShelves();
  for (const [b, name] of marked) b.setAttribute("aria-pressed", String(editor.isActive(name)));
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

/* ------------------------------------------------------------ the Shelf (bottom) */

const S = bar("shelf", "Document");
const shelf = S.el;
S.tag("Document");
const DOC_SIZES: [string, DocSize][] = [
  ["Small", "small"],
  ["Body", "body"],
  ["Large", "large"],
];
const docSizeBtns = DOC_SIZES.map(([name, size]) =>
  S.button(name, `Whole document: ${name}`, () => {
    setDocSize(size);
    scheduleSave();
  }),
);
S.sep();
S.tag("Lists");
S.button(icons.bullets, `Bullet list (${MOD}+Shift+8)`, () => editor.chain().focus().toggleBulletList().run());
S.button(icons.numbers, `Numbered list (${MOD}+Shift+7)`, () => editor.chain().focus().toggleOrderedList().run());
S.sep();
S.tag("Next words");
S.button("<b>B</b>", "Bold for what you type next", () => editor.chain().focus().toggleBold().run());
S.button("<i>I</i>", "Italic for what you type next", () => editor.chain().focus().toggleItalic().run());
for (const role of INK_ROLES) {
  S.button(`<span class="sw" data-ink-swatch="${role}"></span>`, `${INK_LABEL[role]} for what you type next`, () =>
    editor.chain().focus().setInk(role).run(),
  );
}

/* ------------------------------------------------------------ the top shelf */

const T = bar("topshelf", "Window");
const top = T.el;
top.dataset.tauriDragRegion = "";
const tLeft = T.group();
const fileBtn = T.button(`${icons.file}<span>File</span>`, "File", () => toggleMenu(), tLeft);
const crumb = document.createElement("div");
crumb.className = "crumb";
crumb.dataset.tauriDragRegion = "";
top.appendChild(crumb);
const tRight = T.group();
T.tag("Spacing", tRight);
const SPACINGS: [string, Spacing][] = [
  ["Tight", "tight"],
  ["Comfortable", "comfortable"],
  ["Airy", "airy"],
];
const spacingBtns = SPACINGS.map(([name, sp]) =>
  T.button(name, `Line spacing: ${name}`, () => {
    setSpacing(sp);
    scheduleSave();
  }, tRight),
);
T.sep(tRight);
const pagesBtn = T.button(`${icons.pages}<span>Pages</span>`, "Show pages", () => setPages(!pages.enabled), tRight);
T.button(icons.print, `Print (${MOD}+P)`, () => openPrint(), tRight);
T.sep(tRight);
const winCtl = T.group("grp wc");
tRight.appendChild(winCtl);
T.button(icons.min, "Minimise", () => void os.minimize(), winCtl);
const maxBtn = T.button(icons.max, "Maximise", async () => {
  await os.toggleMaximize();
  syncMaxButton();
}, winCtl);
const closeBtn = T.button(icons.close, "Close", () => void os.close(), winCtl);
closeBtn.classList.add("x");

async function syncMaxButton() {
  const m = await os.isMaximized();
  maxBtn.innerHTML = m ? icons.restore : icons.max;
  maxBtn.title = m ? "Restore" : "Maximise";
  maxBtn.setAttribute("aria-label", maxBtn.title);
}
os.onResized(() => void syncMaxButton());

const menu = document.createElement("div");
menu.className = "menu";
menu.hidden = true;
menu.setAttribute("role", "menu");
document.body.appendChild(menu);
const menuItem = (label: string, kbd: string, run: () => void) => {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", "menuitem");
  b.innerHTML = `<span></span><kbd>${kbd}</kbd>`;
  b.firstElementChild!.textContent = label;
  b.addEventListener("click", () => {
    menu.hidden = true;
    run();
  });
  menu.appendChild(b);
};
menuItem("New page", `${MOD} N`, () => void newPage());
menuItem("Print…", `${MOD} P`, () => openPrint());
menu.appendChild(document.createElement("hr"));
menuItem("Show in File Explorer", "", () => void os.showInExplorer(savedPath ?? libraryInbox));

function toggleMenu() {
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }
  const r = fileBtn.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  menu.hidden = false;
}
addEventListener("mousedown", (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node) && !fileBtn.contains(e.target as Node)) menu.hidden = true;
});

function updateCrumb() {
  crumb.innerHTML = "Inbox / <b></b>";
  crumb.querySelector("b")!.textContent = titleOf();
}

/* ------------------------------------------------------------ shelves at the edges */

let topTimer: number | undefined;
let bottomTimer: number | undefined;
// On Windows the top few pixels of a borderless window belong to the resize
// edge, so the page never hears the mouse there. A quick flick to the top
// can skip the band below it entirely, so leaving the page through the top
// (or bottom) edge counts as arriving there. Alt also shows the top shelf.
const TOP_BAND = 44;
const BOTTOM_BAND = 56;
let topByKey = false;

function showTop() {
  clearTimeout(topTimer);
  updateCrumb();
  top.classList.add("on");
}
function showBottom() {
  clearTimeout(bottomTimer);
  shelf.classList.add("on");
}
function hideShelves() {
  clearTimeout(topTimer);
  clearTimeout(bottomTimer);
  topByKey = false;
  shelf.classList.remove("on");
  if (menu.hidden) top.classList.remove("on");
}
addEventListener("mousemove", (e) => {
  const nothingSelected = editor.state.selection.empty;
  if (e.clientY < TOP_BAND && nothingSelected) {
    showTop();
  } else if (top.matches(":hover")) {
    topByKey = false; // reached it; from here it behaves as if hovered in
  } else if (top.classList.contains("on") && menu.hidden && !topByKey) {
    clearTimeout(topTimer);
    topTimer = window.setTimeout(() => top.classList.remove("on"), 400);
  }
  if (e.clientY > innerHeight - BOTTOM_BAND && nothingSelected) {
    showBottom();
  } else if (shelf.classList.contains("on") && !shelf.matches(":hover")) {
    clearTimeout(bottomTimer);
    bottomTimer = window.setTimeout(() => shelf.classList.remove("on"), 350);
  }
});
document.documentElement.addEventListener("mouseleave", (e) => {
  const nothingSelected = editor.state.selection.empty;
  if (e.clientY < TOP_BAND && nothingSelected) showTop();
  else if (!topByKey) topTimer = window.setTimeout(() => menu.hidden && top.classList.remove("on"), 400);
  if (e.clientY > innerHeight - BOTTOM_BAND && nothingSelected) showBottom();
  else bottomTimer = window.setTimeout(() => shelf.classList.remove("on"), 400);
});

// Alt on its own shows or hides the top shelf, like a menu bar in Windows.
let altAlone = false;
addEventListener("keydown", (e) => {
  altAlone = e.key === "Alt" && !e.repeat ? true : e.key === "Alt" ? altAlone : false;
});
addEventListener("keyup", (e) => {
  if (e.key !== "Alt" || !altAlone) return;
  altAlone = false;
  e.preventDefault();
  if (top.classList.contains("on")) {
    hideShelves();
  } else {
    showTop();
    topByKey = true;
  }
});
addEventListener("mousedown", () => (altAlone = false));

/* ------------------------------------------------------------ document settings */

let docSize: DocSize = "body";
function setDocSize(size: DocSize) {
  docSize = size;
  document.body.dataset.size = size;
  docSizeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(DOC_SIZES[i][1] === size)));
  afterLayoutChange();
}

let spacing: Spacing = "comfortable";
function setSpacing(sp: Spacing) {
  spacing = sp;
  document.body.dataset.spacing = sp;
  spacingBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(SPACINGS[i][1] === sp)));
  afterLayoutChange();
}

function afterLayoutChange() {
  // Size and spacing changes animate for 250ms; re-measure pages after that.
  setTimeout(() => {
    if (pages.enabled) pages.recompute();
    placeCaret();
  }, 270);
}

/* ------------------------------------------------------------ print */

const printSheet = document.getElementById("print-sheet")!;
const printStyle = document.createElement("style");
document.head.appendChild(printStyle);
let printColours = "written";
let printNumbers = "on";
for (const group of printSheet.querySelectorAll<HTMLElement>(".ps-seg")) {
  const buttons = group.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (b.dataset.colours) printColours = b.dataset.colours;
      if (b.dataset.numbers) printNumbers = b.dataset.numbers;
    }),
  );
}

function openPrint() {
  menu.hidden = true;
  hideShelves();
  document.getElementById("print-title")!.textContent = `Print “${titleOf()}”`;
  const count = pages.enabled ? pages.pageCount : null;
  document.getElementById("print-sub")!.textContent =
    (count ? `${count} page${count > 1 ? "s" : ""} · ` : "") + "Letter · 1 inch margins";
  printSheet.hidden = false;
  (document.getElementById("print-go") as HTMLButtonElement).focus();
}
function closePrint() {
  printSheet.hidden = true;
  editor.commands.focus();
}
document.getElementById("print-cancel")!.addEventListener("click", closePrint);
printSheet.addEventListener("keydown", (e) => e.key === "Escape" && closePrint());
document.getElementById("print-go")!.addEventListener("click", () => {
  printSheet.hidden = true;
  document.body.classList.toggle("print-black", printColours === "black");
  printStyle.textContent =
    printNumbers === "on"
      ? `@page { @bottom-center { content: counter(page); font-family: Spectral, Georgia, serif; font-size: 10pt; color: #666; } }`
      : "";
  // Let the sheet disappear before the system dialog takes over.
  setTimeout(() => {
    window.print();
    editor.commands.focus();
  }, 60);
});

/* ---------------------------------------------------------------- autosave */

let fileName = newFileName();
let savedPath: string | null = null;
let libraryInbox = "";
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
    savedPath = await saveDocument(fileName, toFile(titleOf(), docSize, spacing, editor.getHTML()));
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
os.onClose(saveNow);

/* --------------------------------------------------------------- new page */

async function newPage() {
  await saveNow();
  fileName = newFileName();
  savedPath = null;
  editor.commands.clearContent(true);
  saved = true;
  setDocSize("body");
  setSpacing("comfortable");
  editor.commands.focus("start");
}

/* --------------------------------------------------------------- keys */

addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === "F11") {
    e.preventDefault();
    void os.toggleFullscreen().then(() => setTimeout(placeCaret, 200));
  } else if (mod && k === "n") {
    e.preventDefault();
    void newPage();
  } else if (mod && k === "s") {
    e.preventDefault(); // saving is automatic; Ctrl+S just saves right now
    void saveNow();
  } else if (mod && k === "p") {
    e.preventDefault();
    openPrint();
  } else if (e.key === "Escape" && !menu.hidden) {
    menu.hidden = true;
  } else if (e.key === "Escape" && top.classList.contains("on")) {
    hideShelves();
  }
});

// Clicking anywhere outside the text (margins, the desk) returns you to it.
page.addEventListener("mousedown", (e) => {
  const t = e.target as HTMLElement;
  if (t === page || t.id === "sheets" || t.classList.contains("sheet") || t.id === "sheet-layer") {
    e.preventDefault();
    editor.commands.focus("end");
  }
});

/* --------------------------------------------------------------- start */

setDocSize("body");
setSpacing("comfortable");
setPages(pref.get("pages") === "on");
void (async () => {
  try {
    const { libraryPath } = await import("./storage");
    libraryInbox = (await libraryPath()) + (navigator.userAgent.includes("Windows") ? "\\Inbox" : "/Inbox");
  } catch {
    /* only used for Show in File Explorer */
  }
})();
document.fonts?.ready.then(() => {
  if (pages.enabled) pages.recompute();
  placeCaret();
});
