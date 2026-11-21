/**
 * Quick capture: the small window that Ctrl+Alt+Q brings up from anywhere.
 *
 * Type, press Enter, and it's saved as a new document in Quick Capture. To file it
 * straight away, press Tab, start typing a folder name and press Enter.
 * Shift+Enter starts a new line. Esc (or clicking elsewhere) puts the window
 * away and keeps what you typed for next time.
 */
import "./fonts";
import "./styles.css";
import "./capture.css";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { library, newFileName, toFile, joinPath, errorText, QUICK, type FolderEntry } from "./storage";
import { inTauri } from "./platform";
import { Autocorrect, autocorrectNow } from "./autocorrect";
import { startSkins, onSkinChange, caretBox, flare, keySound } from "./skins";

startSkins(); // the same skin as the main window, and it follows changes made there

const textEl = document.getElementById("cap-text")!;
const foldersEl = document.getElementById("cap-folders")!;
const filter = document.getElementById("cap-filter") as HTMLInputElement;
const list = document.getElementById("cap-list")!;
const chip = document.getElementById("cap-chip")!;
const caret = document.getElementById("caret")!;
const done = document.getElementById("cap-done")!;

const DRAFT_KEY = "quill:capture-draft";
const draft = {
  get: () => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (html: string) => {
    try {
      if (html) localStorage.setItem(DRAFT_KEY, html);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* the draft also stays in the window while Quill runs */
    }
  },
};

/* ------------------------------------------------------------ the text */

const editor = new Editor({
  element: textEl,
  extensions: [
    StarterKit.configure({
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
      dropcursor: false,
      trailingNode: false,
    }),
    Placeholder.configure({ placeholder: "A thought, before it goes…" }),
    Autocorrect,
  ],
  content: draft.get(),
  enableInputRules: false,
  enablePasteRules: false,
  editorProps: {
    attributes: { class: "ed", spellcheck: "true", "aria-label": "Quick capture" },
    handleKeyDown: (_view, e) => {
      if (e.key === "Enter" && e.shiftKey) {
        editor.commands.splitBlock(); // a new line
        return true;
      }
      if (e.key === "Enter" && !e.isComposing) {
        autocorrectNow(editor);
        void save();
        return true;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        openFolders();
        return true;
      }
      return false;
    },
  },
});
editor.on("update", () => draft.set(editor.isEmpty ? "" : editor.getHTML()));

/* ------------------------------------------------------------ the skin's cursor, as in the main window */

function placeCaret() {
  const { view, state } = editor;
  if (!view.hasFocus() || !state.selection.empty) {
    caret.classList.remove("on");
    return;
  }
  const b = caretBox(view.coordsAtPos(state.selection.head));
  caret.style.transform = `translate(${b.x}px, ${b.y}px)`;
  caret.style.height = `${b.h}px`;
  caret.style.width = b.w ? `${b.w}px` : "";
  caret.classList.add("on");
}
onSkinChange(() => requestAnimationFrame(placeCaret));
editor.on("selectionUpdate", placeCaret);
editor.on("transaction", () => requestAnimationFrame(placeCaret));
editor.on("focus", placeCaret);
editor.on("blur", () => caret.classList.remove("on"));
textEl.addEventListener("scroll", placeCaret, { passive: true });
let typingTimer: number | undefined;
editor.view.dom.addEventListener("keydown", (e) => {
  keySound(e);
  flare(caret);
  document.body.classList.add("typing");
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => document.body.classList.remove("typing"), 600);
});
textEl.addEventListener("mousedown", (e) => {
  if (e.target === textEl) {
    e.preventDefault();
    editor.commands.focus("end");
  }
});

/* ------------------------------------------------------------ where it goes */

let folder = QUICK;
let folders: string[] = [QUICK];
let shown: string[] = [];
let picked = 0;

function setFolder(path: string) {
  folder = path;
  chip.innerHTML = "Save to: <b></b>";
  chip.querySelector("b")!.textContent = path.split("/").join(" / ");
}

async function loadFolders() {
  try {
    const tree = await library.list();
    const out: string[] = [];
    const walk = (f: FolderEntry) => {
      for (const c of f.children) {
        if (c.kind === "folder") {
          out.push(c.path);
          walk(c);
        }
      }
    };
    walk(tree);
    // Quick Capture comes first, even before the first capture makes it.
    folders = [QUICK, ...out.filter((f) => f !== QUICK)];
  } catch {
    folders = [QUICK];
  }
}

/** Folders matching what you've typed: the start of a name first, then anywhere in the path. */
function matches(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return folders;
  const starts = folders.filter((f) => f.split("/").some((part) => part.toLowerCase().startsWith(s)));
  const within = folders.filter((f) => !starts.includes(f) && f.toLowerCase().includes(s));
  return [...starts, ...within];
}

function drawFolders() {
  shown = matches(filter.value);
  picked = Math.min(picked, Math.max(0, shown.length - 1));
  list.replaceChildren(
    ...(shown.length
      ? shown.map((f, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.setAttribute("role", "option");
          b.setAttribute("aria-selected", String(i === picked));
          b.textContent = f.split("/").join(" / ");
          if (f === QUICK) b.appendChild(Object.assign(document.createElement("span"), { textContent: "default" }));
          if (i === picked) b.appendChild(Object.assign(document.createElement("span"), { textContent: "Enter" }));
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            setFolder(f);
            closeFolders();
          });
          return b;
        })
      : [Object.assign(document.createElement("div"), { className: "none", textContent: "No folder by that name" })]),
  );
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function openFolders() {
  foldersEl.hidden = false;
  filter.value = "";
  picked = Math.max(0, folders.indexOf(folder));
  drawFolders();
  filter.focus();
  void loadFolders().then(() => !foldersEl.hidden && drawFolders());
}

function closeFolders() {
  foldersEl.hidden = true;
  editor.commands.focus();
}

filter.addEventListener("input", () => {
  picked = 0;
  drawFolders();
});
filter.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    picked = Math.max(0, Math.min(shown.length - 1, picked + (e.key === "ArrowDown" ? 1 : -1)));
    drawFolders();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!shown.length) return;
    setFolder(shown[picked]);
    closeFolders();
    void save();
  } else if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    closeFolders();
  } else if (e.key === "Tab") {
    e.preventDefault();
    if (shown.length) setFolder(shown[picked]);
    closeFolders();
  }
});
chip.addEventListener("mousedown", (e) => e.preventDefault());
chip.addEventListener("click", () => (foldersEl.hidden ? openFolders() : closeFolders()));

/* ------------------------------------------------------------ saving */

const win = inTauri ? getCurrentWindow() : null;

async function putAway() {
  foldersEl.hidden = true;
  if (win) await win.hide();
}

/** A file name nobody has used yet, even for two captures in the same second. */
async function freePath(dir: string): Promise<string> {
  const base = newFileName().replace(/\.html$/, "");
  for (let n = 1; ; n++) {
    const path = joinPath(dir, n === 1 ? `${base}.html` : `${base} ${n}.html`);
    try {
      await library.read(path);
    } catch {
      return path;
    }
  }
}

let saving = false;
async function save() {
  if (saving) return;
  if (editor.isEmpty) return void putAway();
  saving = true;
  try {
    const first = editor.state.doc.firstChild?.textContent.trim() ?? "";
    const path = await freePath(folder);
    await library.save(path, toFile(first.slice(0, 80).trim() || "Untitled", "comfortable", "", editor.getHTML()));
    if (inTauri) void emitTo("main", "library://changed");
    // A moment of confirmation, then out of the way.
    done.innerHTML = "Saved to <b></b>";
    done.querySelector("b")!.textContent = folder.split("/").join(" / ");
    done.classList.add("on");
    editor.commands.clearContent(true);
    editor.commands.focus();
    draft.set("");
    setFolder(QUICK);
    setTimeout(async () => {
      await putAway();
      done.classList.remove("on");
    }, 450);
  } catch (e) {
    done.textContent = errorText(e);
    done.classList.add("on");
    setTimeout(() => done.classList.remove("on"), 2500);
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------------------ coming and going */

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && foldersEl.hidden) {
    e.preventDefault();
    void putAway(); // what you typed stays for next time
  }
});

function arrive() {
  done.classList.remove("on");
  foldersEl.hidden = true;
  editor.commands.focus("end");
  void loadFolders();
}

if (win) {
  // Clicking somewhere else puts it away too, like a menu: but only once it
  // has really had the focus, and not in the first moment, while Windows
  // may still be handing the focus over.
  let hadFocus = false;
  let shownAt = 0;
  void listen("capture://open", () => {
    hadFocus = false;
    shownAt = Date.now();
    arrive();
  });
  void listen("capture://hide", () => void putAway());
  void win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      hadFocus = true;
      editor.commands.focus("end");
    } else if (hadFocus && !saving && Date.now() - shownAt > 600) {
      hadFocus = false;
      void putAway();
    }
  });
}

setFolder(QUICK);
arrive();
