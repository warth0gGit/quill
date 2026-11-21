/**
 * The library panel: the Branches tree that slides in from the left.
 *
 * Folders hang off curved cobalt branches. A closed folder is a ring and an
 * open one a solid ball. Click a folder to open or close it, double-click its
 * name (or press F2) to rename it, and drag folders and documents onto another
 * folder to move them. The bin moves things to the Trash, and every move and
 * delete can be undone from the note at the bottom of the panel.
 */
import { library, INBOX, errorText, nameOf, parentOf, within, type Entry, type FolderEntry } from "./storage";

export interface LibraryHooks {
  /** Path of the document being edited ("" before its first save). */
  current(): string;
  open(path: string): Promise<void>;
  /** Called before files move, so the open document is safely on disk. */
  saveFirst(): Promise<void>;
  /** Something moved or was renamed; the open document may be inside it. */
  moved(from: string, to: string): void;
  /** Something went to the Trash; the open document may be inside it. */
  removed(path: string): void;
}

const bin =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const plus =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

const OPEN_KEY = "quill:pref:libOpen";
const loadOpen = (): Set<string> => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (Array.isArray(v)) return new Set(v.filter((x) => typeof x === "string"));
  } catch {
    /* default below */
  }
  return new Set(["", INBOX]);
};

const countDocs = (f: FolderEntry): number =>
  f.children.reduce((n, c) => n + (c.kind === "doc" ? 1 : countDocs(c)), 0);

export function createLibrary(hooks: LibraryHooks) {
  const el = document.createElement("aside");
  el.className = "library";
  el.setAttribute("aria-label", "Library");
  el.innerHTML = `
    <div class="lib-tree branches" role="tree" aria-label="Folders and documents"></div>
    <div class="lib-toast" role="status"><span></span><button type="button">Undo</button></div>`;
  document.body.appendChild(el);
  const host = el.querySelector<HTMLElement>(".lib-tree")!;
  const toastEl = el.querySelector<HTMLElement>(".lib-toast")!;
  const toastMsg = toastEl.querySelector("span")!;
  const undoBtn = toastEl.querySelector("button")!;

  const openFolders = loadOpen();
  const remember = () => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...openFolders]));
    } catch {
      /* a convenience only */
    }
  };

  let tree: FolderEntry | null = null;
  let dragged: Entry | null = null;
  let editing: { path: string; mode: "new" | "rename" } | null = null;
  let busy = false;

  /* ------------------------------------------------------------ the note at the bottom */

  let toastTimer: number | undefined;
  let undo: (() => Promise<void>) | null = null;
  function toast(message: string, undoFn: (() => Promise<void>) | null = null) {
    toastMsg.textContent = message;
    undo = undoFn;
    undoBtn.hidden = !undoFn;
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("on"), undoFn ? 6000 : 3500);
  }
  undoBtn.addEventListener("click", async () => {
    const fn = undo;
    undo = null;
    toastEl.classList.remove("on");
    if (fn) await act(fn);
  });

  /** Run a library change, then redraw; errors show in the note. */
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
      await refresh();
    }
  }

  /* ------------------------------------------------------------ actions */

  async function moveInto(item: Entry, into: string) {
    if (parentOf(item.path) === into) return;
    const label = item.kind === "doc" ? item.title : item.name;
    const intoName = into === "" ? "the Library" : nameOf(into);
    await act(async () => {
      await hooks.saveFirst();
      const from = item.path;
      const to = await library.move(from, into);
      hooks.moved(from, to);
      openFolders.add(into);
      remember();
      toast(`Moved “${label}” into ${intoName}`, async () => {
        const back = await library.move(to, parentOf(from));
        hooks.moved(to, back);
      });
    });
  }

  async function trash(item: Entry) {
    const label = item.kind === "doc" ? item.title : item.name;
    await act(async () => {
      await hooks.saveFirst();
      const id = await library.trash(item.path);
      hooks.removed(item.path);
      toast(`Moved “${label}” to the Trash`, async () => {
        await library.restore(id);
      });
    });
  }

  async function commitName(value: string) {
    const e = editing;
    editing = null;
    if (!e) return;
    const name = value.trim();
    if (e.mode === "new") {
      if (!name) return void (await refresh());
      await act(async () => {
        const path = await library.createFolder(e.path, name);
        openFolders.add(e.path);
        remember();
        focusAfter = path;
      });
    } else {
      if (!name || name === nameOf(e.path)) return void (await refresh());
      await act(async () => {
        await hooks.saveFirst();
        const to = await library.renameFolder(e.path, name);
        hooks.moved(e.path, to);
        if (openFolders.delete(e.path)) openFolders.add(to);
        remember();
        focusAfter = to;
      });
    }
  }

  /* ------------------------------------------------------------ drawing */

  let focusAfter: string | null = null;

  function nameInput(initial: string, placeholder: string) {
    const input = document.createElement("input");
    input.className = "nm-input";
    input.value = initial;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    input.spellcheck = false;
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      void commitName(keep ? input.value : "");
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    return input; // draw() focuses it once it's in the page
  }

  function dropTarget(row: HTMLElement, folder: FolderEntry) {
    const allowed = () =>
      !!dragged && !(dragged.kind === "folder" && within(folder.path, dragged.path)) && parentOf(dragged.path) !== folder.path;
    row.addEventListener("dragover", (e) => {
      if (!allowed()) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      row.classList.add("drop");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop");
      const item = allowed() ? dragged : null;
      dragged = null;
      if (item) void moveInto(item, folder.path);
    });
  }

  function draggable(row: HTMLElement, item: Entry) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      dragged = item;
      e.dataTransfer!.effectAllowed = "move";
      try {
        e.dataTransfer!.setData("text/plain", item.kind === "doc" ? item.title : item.name);
      } catch {
        /* some engines refuse; the drag still works */
      }
      setTimeout(() => row.classList.add("dragging"), 0);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      dragged = null;
      host.querySelectorAll(".drop").forEach((r) => r.classList.remove("drop"));
    });
  }

  function action(html: string, title: string, run: () => void, extra = "") {
    const b = document.createElement("span");
    b.className = `act ${extra}`;
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    return b;
  }

  function docLi(d: Extract<Entry, { kind: "doc" }>) {
    const li = document.createElement("li");
    li.className = "doc-li";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "doc" + (d.path === hooks.current() ? " current" : "");
    row.dataset.path = d.path;
    row.setAttribute("role", "treeitem");
    if (d.path === hooks.current()) row.setAttribute("aria-current", "true");
    row.innerHTML = '<span class="dot"></span><span class="nm"></span>';
    row.querySelector(".nm")!.textContent = d.title;
    row.title = d.title;
    row.appendChild(action(bin, `Move “${d.title}” to the Trash`, () => void trash(d), "del"));
    row.addEventListener("click", () => void hooks.open(d.path));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Delete") void trash(d);
    });
    draggable(row, d);
    li.appendChild(row);
    return li;
  }

  function folderLi(f: FolderEntry, depth: number): HTMLLIElement {
    const isOpen = depth === 0 || openFolders.has(f.path);
    const li = document.createElement("li");
    li.className = "folder" + (isOpen ? " open" : "");
    const protectedFolder = depth === 0 || f.path === INBOX;

    let row: HTMLElement;
    if (editing?.mode === "rename" && editing.path === f.path) {
      row = document.createElement("div");
      row.className = "row";
      row.innerHTML = '<span class="ball"></span>';
      row.appendChild(nameInput(f.name, "Folder name"));
    } else {
      const b = document.createElement("button");
      b.type = "button";
      row = b;
      row.className = "row" + (depth === 0 ? " root-row" : "");
      row.dataset.path = f.path;
      row.setAttribute("role", "treeitem");
      if (depth > 0) row.setAttribute("aria-expanded", String(isOpen));
      row.innerHTML = '<span class="ball"></span><span class="nm"></span><span class="ct"></span>';
      row.querySelector(".nm")!.textContent = f.name;
      row.querySelector(".ct")!.textContent = String(countDocs(f) || "");
      row.appendChild(
        action(plus, depth === 0 ? "New folder" : `New folder inside ${f.name}`, () => {
          openFolders.add(f.path);
          editing = { path: f.path, mode: "new" };
          draw();
        }),
      );
      if (!protectedFolder) {
        row.appendChild(action(bin, `Move ${f.name} to the Trash`, () => void trash(f), "del"));
        draggable(row, f);
        row.querySelector(".nm")!.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          editing = { path: f.path, mode: "rename" };
          draw();
        });
      }
      row.addEventListener("click", () => {
        if (depth === 0) return;
        const open = !openFolders.has(f.path);
        if (open) openFolders.add(f.path);
        else openFolders.delete(f.path);
        remember();
        li.classList.toggle("open", open);
        row.setAttribute("aria-expanded", String(open));
      });
      row.addEventListener("keydown", (e) => {
        if (protectedFolder) return;
        if (e.key === "F2") {
          e.preventDefault();
          editing = { path: f.path, mode: "rename" };
          draw();
        } else if (e.key === "Delete") {
          void trash(f);
        }
      });
      dropTarget(row, f);
    }
    li.appendChild(row);

    const kids = document.createElement("div");
    kids.className = "kids";
    const inner = document.createElement("div");
    const ul = document.createElement("ul");
    ul.setAttribute("role", "group");
    if (editing?.mode === "new" && editing.path === f.path) {
      const nli = document.createElement("li");
      nli.className = "folder";
      const nrow = document.createElement("div");
      nrow.className = "row";
      nrow.innerHTML = '<span class="ball"></span>';
      nrow.appendChild(nameInput("", "Folder name"));
      nli.appendChild(nrow);
      ul.appendChild(nli);
    }
    for (const c of f.children) ul.appendChild(c.kind === "doc" ? docLi(c) : folderLi(c, depth + 1));
    inner.appendChild(ul);
    kids.appendChild(inner);
    li.appendChild(kids);
    return li;
  }

  function draw() {
    if (!tree) return;
    const ul = document.createElement("ul");
    ul.appendChild(folderLi(tree, 0));
    host.replaceChildren(ul);
    const input = host.querySelector<HTMLInputElement>(".nm-input");
    if (input) {
      input.focus();
      input.select();
    } else if (focusAfter !== null) {
      host.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusAfter)}"]`)?.focus();
      focusAfter = null;
    }
  }

  async function refresh() {
    try {
      tree = await library.list();
    } catch (e) {
      toast(errorText(e));
      return;
    }
    draw();
  }

  /** Open the folders above the current document and bring it into view. */
  function reveal() {
    const cur = hooks.current();
    if (!cur) return;
    for (let p = parentOf(cur); p; p = parentOf(p)) openFolders.add(p);
    remember();
    draw();
    host.querySelector<HTMLElement>(".doc.current")?.scrollIntoView({ block: "nearest" });
  }

  /* ------------------------------------------------------------ showing and hiding */

  let pinned = false;
  let leaveTimer: number | undefined;
  const isOpen = () => el.classList.contains("on");

  async function open(pin: boolean) {
    pinned = pinned || pin;
    clearTimeout(leaveTimer);
    leaveTimer = undefined;
    if (isOpen()) return;
    el.classList.add("on");
    await refresh();
    reveal();
  }
  function close() {
    pinned = false;
    if (editing) return; // finish naming first
    el.classList.remove("on");
  }

  // The tree slides away when the mouse leaves it, unless it was opened from
  // the keyboard or a button (then Esc, a click on the page or opening a
  // document puts it away).
  el.addEventListener("mouseenter", () => {
    clearTimeout(leaveTimer);
    leaveTimer = undefined;
  });
  el.addEventListener("mouseleave", () => {
    if (pinned || dragged) return;
    leaveTimer = window.setTimeout(() => {
      leaveTimer = undefined;
      if (!pinned && !dragged) close();
    }, 450);
  });

  return {
    el,
    open,
    close,
    isOpen,
    refresh: () => (isOpen() ? refresh() : Promise.resolve()),
    toggle: () => (isOpen() ? close() : void open(true)),
    /** The mouse is well away from the tree: put it away soon, unless pinned. */
    closeSoon() {
      if (pinned || dragged || !isOpen() || leaveTimer) return;
      leaveTimer = window.setTimeout(() => {
        leaveTimer = undefined;
        if (!pinned && !dragged && !el.matches(":hover")) close();
      }, 450);
    },
    get pinned() {
      return pinned;
    },
    get editing() {
      return !!editing;
    },
  };
}
