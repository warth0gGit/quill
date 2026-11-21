/**
 * The library: folders and documents under Documents\Quill. Inside the
 * desktop app the Rust side does all the disk work (see src-tauri/src/library.rs).
 * In a plain browser (vite dev) a small stand-in keeps the library in
 * localStorage with the same rules, so the editor and tree can be tried.
 *
 * Paths are relative to the library and use "/", e.g. "Essays/2026-11-20-160412.html".
 * The empty string is the library itself.
 *
 * A document's pictures live in a folder named after it, beside it:
 * "Inbox/2026-11-20-160412.html" keeps them in "Inbox/2026-11-20-160412 images/".
 * The page refers to them relative to its own folder, so the file reads
 * correctly in any browser and wherever the document is moved.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export type Spacing = "tight" | "comfortable" | "airy";

export const LINE_HEIGHT: Record<Spacing, number> = { tight: 1.45, comfortable: 1.75, airy: 2.05 };
export const INBOX = "Inbox";
/** Where quick captures go unless you pick another folder. Made on the first capture. */
export const QUICK = "Quick Capture";

export interface FolderEntry {
  kind: "folder";
  name: string;
  path: string;
  children: Entry[];
}
export interface DocEntry {
  kind: "doc";
  name: string;
  path: string;
  title: string;
  modified: number;
}
export type Entry = FolderEntry | DocEntry;

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function newFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.html`
  );
}

export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
/** Is `path` the item at `item`, or inside it? */
export const within = (path: string, item: string) => path === item || path.startsWith(item + "/");
/** "Inbox/x.html" -> "x images", the folder beside it that holds its pictures. */
export const imagesFolderOf = (docPath: string) => nameOf(docPath).replace(/\.html$/, "") + " images";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The stored file: readable in any browser, and loadable back into Quill. */
/** `next` is the Shelf's style for what you type next, e.g. "size=large;bold". */
export function toFile(title: string, spacing: Spacing, next: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="Quill">
<meta name="quill-spacing" content="${spacing}">
<meta name="quill-next" content="${esc(next)}">
<title>${esc(title)}</title>
<style>
body{max-width:62ch;margin:56px auto;padding:0 20px;font-family:Spectral,Georgia,serif;line-height:${LINE_HEIGHT[spacing]};color:#2B2D31;background:#FBFBF9;font-size:19px}
p{margin:0 0 .85em}s{opacity:.45}ul,ol{margin:0 0 .85em;padding-left:1.6em}li p{margin:0}ul{list-style:none}ul>li{position:relative}ul>li::before{content:"\\2022";position:absolute;left:-1.05em;color:#1F4FD1;font-weight:600}ol>li::marker{color:#1F4FD1}
[data-size=small]{font-size:.84em}[data-size=large]{font-size:1.32em}[data-size=title]{font-size:1.85em;line-height:1.25}
figure{margin:.4em auto 1.1em;width:75%}figure img{display:block;width:100%;height:auto;border-radius:6px}figcaption{font-size:.8em;line-height:1.45;opacity:.7;font-style:italic;text-align:center;padding-top:8px}
figure[data-size=s]{width:33.3%}figure[data-size=m]{width:50%}figure[data-size=full]{width:100%}
figure[data-align=left]{float:left;margin:.35em 1.4em .5em 0;clear:both}figure[data-align=right]{float:right;margin:.35em 0 .5em 1.4em;clear:both}
figure[data-align=left][data-size=s],figure[data-align=right][data-size=s]{width:30%}figure[data-align=left][data-size=m],figure[data-align=right][data-size=m]{width:42%}figure[data-align=left][data-size=l],figure[data-align=right][data-size=l]{width:55%}
figure[data-align=left] figcaption,figure[data-align=right] figcaption{text-align:left}figure[data-align=wide]{width:calc(100% + 128px);margin-left:-64px;margin-right:-64px}
[data-ink=midnight]{color:#16275A}[data-ink=cobalt]{color:#1F4FD1}[data-ink=azure]{color:#1F73B8}[data-ink=signal]{color:#D2232A}
@media (prefers-color-scheme:dark){body{background:#17191C;color:#E3E4E0}[data-ink=midnight]{color:#9DAEE6}[data-ink=cobalt]{color:#7C9CFF}[data-ink=azure]{color:#6CB4F0}[data-ink=signal]{color:#FF6B6B}}
</style>
</head>
<body>
<article>
${bodyHtml}
</article>
</body>
</html>
`;
}

/** Read a stored file back: its document settings and the body to edit. */
export function fromFile(html: string): { spacing: Spacing; next: string; body: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";
  const spacing = (["tight", "comfortable", "airy"] as const).find((s) => s === meta("quill-spacing")) ?? "comfortable";
  const body = (doc.querySelector("article") ?? doc.body).innerHTML.trim();
  return { spacing, next: meta("quill-next"), body };
}

/* ------------------------------------------------------------ browser stand-in */

interface MockState {
  folders: string[];
  docs: Record<string, { contents: string; modified: number }>;
  trash: Record<string, { origin: string; folders: string[]; docs: MockState["docs"] }>;
}
const MOCK_KEY = "quill:library";
/** Pictures in the browser preview: library path -> object URL. Kept for this session only. */
const mockImages = new Map<string, string>();
const moveImages = (from: string, to: string) => {
  for (const [p, url] of [...mockImages]) {
    if (within(p, from)) {
      mockImages.delete(p);
      mockImages.set(to + p.slice(from.length), url);
    }
  }
};
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const validName = (n: string) => !!n && n.length <= 120 && n.trim() === n && !n.startsWith(".") && !n.endsWith(".") && !BAD_NAME.test(n);

function mockLoad(): MockState {
  try {
    const s = JSON.parse(localStorage.getItem(MOCK_KEY) ?? "") as MockState;
    if (s.folders && s.docs && s.trash) return s;
  } catch {
    /* start fresh */
  }
  return { folders: [INBOX], docs: {}, trash: {} };
}
function mockSave(s: MockState) {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(s));
  } catch {
    /* browser preview only */
  }
}
const exists = (s: MockState, p: string) => p === "" || s.folders.includes(p) || p in s.docs;
function freeName(s: MockState, dir: string, name: string) {
  if (!exists(s, joinPath(dir, name))) return name;
  const [stem, ext] = name.endsWith(".html") ? [name.slice(0, -5), ".html"] : [name, ""];
  for (let n = 2; ; n++) if (!exists(s, joinPath(dir, `${stem} ${n}${ext}`))) return `${stem} ${n}${ext}`;
}
function relocate(s: MockState, from: string, to: string) {
  moveImages(from, to);
  if (from.endsWith(".html")) moveImages(joinPath(parentOf(from), imagesFolderOf(from)), joinPath(parentOf(to), imagesFolderOf(to)));
  s.folders = s.folders.map((f) => (within(f, from) ? to + f.slice(from.length) : f));
  for (const d of Object.keys(s.docs)) {
    if (within(d, from)) {
      s.docs[to + d.slice(from.length)] = s.docs[d];
      delete s.docs[d];
    }
  }
}
const titleIn = (html: string) => {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  const t = m ? new DOMParser().parseFromString(m[1], "text/html").body.textContent?.trim() : "";
  return t || "Untitled";
};
function mockTree(s: MockState, path = "", name = "Library"): FolderEntry {
  const kids = (p: string) => parentOf(p) === path && p !== "";
  const folders = s.folders
    .filter(kids)
    .sort((a, b) => (path === "" && a === INBOX ? -1 : path === "" && b === INBOX ? 1 : a.toLowerCase().localeCompare(b.toLowerCase())))
    .map((f) => mockTree(s, f, nameOf(f)));
  const docs: DocEntry[] = Object.entries(s.docs)
    .filter(([p]) => kids(p))
    .map(([p, d]) => ({ kind: "doc" as const, name: nameOf(p), path: p, title: titleIn(d.contents), modified: d.modified }))
    .sort((a, b) => b.modified - a.modified);
  return { kind: "folder", name, path, children: [...folders, ...docs] };
}

const mock = {
  list: () => mockTree(mockLoad()),
  save(path: string, contents: string) {
    const s = mockLoad();
    let dir = parentOf(path);
    while (dir && !s.folders.includes(dir)) {
      s.folders.push(dir);
      dir = parentOf(dir);
    }
    s.docs[path] = { contents, modified: Date.now() };
    mockSave(s);
    return path;
  },
  read(path: string) {
    const d = mockLoad().docs[path];
    if (!d) throw new Error(`Couldn't open ${path}`);
    return d.contents;
  },
  createFolder(parent: string, name: string) {
    const s = mockLoad();
    name = name.trim();
    if (!validName(name)) throw new Error(`“${name}” can't be used as a folder name`);
    const path = joinPath(parent, name);
    if (exists(s, path)) throw new Error(`There's already a folder called “${name}” there`);
    s.folders.push(path);
    mockSave(s);
    return path;
  },
  renameFolder(path: string, name: string) {
    const s = mockLoad();
    name = name.trim();
    if (path === INBOX) throw new Error("The Inbox can't be renamed");
    if (!validName(name)) throw new Error(`“${name}” can't be used as a folder name`);
    const to = joinPath(parentOf(path), name);
    if (to !== path && exists(s, to)) throw new Error(`There's already a folder called “${name}” there`);
    relocate(s, path, to);
    mockSave(s);
    return to;
  },
  move(path: string, into: string) {
    const s = mockLoad();
    if (path === INBOX) throw new Error("The Inbox stays where it is");
    if (within(into, path)) throw new Error("A folder can't go inside itself");
    if (parentOf(path) === into) return path;
    const to = joinPath(into, freeName(s, into, nameOf(path)));
    relocate(s, path, to);
    mockSave(s);
    return to;
  },
  trash(path: string) {
    const s = mockLoad();
    if (path === INBOX) throw new Error("The Inbox can't be moved to the Trash");
    const id = String(Date.now());
    const docs: MockState["docs"] = {};
    for (const d of Object.keys(s.docs)) if (within(d, path)) (docs[d] = s.docs[d]), delete s.docs[d];
    const folders = s.folders.filter((f) => within(f, path));
    s.folders = s.folders.filter((f) => !within(f, path));
    s.trash[id] = { origin: path, folders, docs };
    mockSave(s);
    return id;
  },
  restore(id: string) {
    const s = mockLoad();
    const t = s.trash[id];
    if (!t) throw new Error("That's no longer in the Trash");
    const to = joinPath(parentOf(t.origin), freeName(s, parentOf(t.origin), nameOf(t.origin)));
    const move = (p: string) => to + p.slice(t.origin.length);
    moveImages(t.origin, to);
    s.folders.push(...t.folders.map(move));
    for (const [p, d] of Object.entries(t.docs)) s.docs[move(p)] = d;
    delete s.trash[id];
    mockSave(s);
    return to;
  },
  saveImage(doc: string, name: string, bytes: Uint8Array, type: string) {
    if (!/^image\//.test(type)) throw new Error("That isn't a picture Quill can show (try PNG, JPEG, GIF or WebP)");
    const folder = imagesFolderOf(doc);
    const ext = type === "image/jpeg" ? "jpg" : type.slice(6).replace(/\W.*$/, "") || "png";
    const stem = (name.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").replace(/[<>:"/\\|?*%#\u0000-\u001f]/g, "-").trim() || "picture").slice(0, 60);
    const dir = joinPath(parentOf(doc), folder);
    let file = `${stem}.${ext}`;
    for (let n = 2; mockImages.has(joinPath(dir, file)); n++) file = `${stem} ${n}.${ext}`;
    mockImages.set(joinPath(dir, file), URL.createObjectURL(new Blob([bytes as BlobPart], { type })));
    return `${folder}/${file}`;
  },
  copyImage(from: string, doc: string) {
    const url = mockImages.get(from);
    if (!url) throw new Error("That picture no longer exists");
    const folder = imagesFolderOf(doc);
    const dir = joinPath(parentOf(doc), folder);
    let file = nameOf(from);
    const [stem, ext] = [file.replace(/\.[^.]*$/, ""), file.slice(file.lastIndexOf("."))];
    for (let n = 2; mockImages.has(joinPath(dir, file)); n++) file = `${stem} ${n}${ext}`;
    mockImages.set(joinPath(dir, file), url);
    return `${folder}/${file}`;
  },
  discardUnsavedImages(doc: string) {
    if (doc in mockLoad().docs) return;
    const dir = joinPath(parentOf(doc), imagesFolderOf(doc));
    for (const p of [...mockImages.keys()]) if (within(p, dir)) mockImages.delete(p);
  },
};

/* ------------------------------------------------------------ the API */

const call = <T>(cmd: string, args: Record<string, unknown>, fallback: () => T): Promise<T> =>
  inTauri ? invoke<T>(cmd, args) : Promise.resolve().then(fallback);

export const library = {
  list: () => call<FolderEntry>("list_library", {}, mock.list),
  /** Saves a document and returns its full path on disk. */
  save: (path: string, contents: string) => call<string>("save_document", { path, contents }, () => mock.save(path, contents)),
  read: (path: string) => call<string>("read_document", { path }, () => mock.read(path)),
  fullPath: (path: string) => call<string>("full_path", { path }, () => path),
  createFolder: (parent: string, name: string) =>
    call<string>("create_folder", { parent, name }, () => mock.createFolder(parent, name)),
  renameFolder: (path: string, name: string) =>
    call<string>("rename_folder", { path, name }, () => mock.renameFolder(path, name)),
  /** Moves a folder or document into another folder; returns its new path. */
  move: (path: string, into: string) => call<string>("move_item", { path, into }, () => mock.move(path, into)),
  /** Moves something to the Trash; returns an id that Undo passes to restore. */
  trash: (path: string) => call<string>("trash_item", { path }, () => mock.trash(path)),
  restore: (id: string) => call<string>("restore_item", { id }, () => mock.restore(id)),
  rootPath: () => call<string>("library_path", {}, () => "browser preview (not saved to disk)"),
  /**
   * Keeps a picture for the document at `doc` and returns the path the page
   * uses for it, relative to the document's folder ("x images/photo.png").
   * The bytes go to Rust as they are, not as JSON.
   */
  saveImage: async (doc: string, file: Blob, name = ""): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!inTauri) return mock.saveImage(doc, name, bytes, file.type);
    return invoke<string>("save_image", bytes, {
      headers: { "x-doc": encodeURIComponent(doc), "x-name": encodeURIComponent(name) },
    });
  },
  /** Copies a picture (a library path) into `doc`'s pictures folder. */
  copyImage: (from: string, doc: string) => call<string>("copy_image", { from, doc }, () => mock.copyImage(from, doc)),
  /** Removes the pictures folder of a document that never got saved. */
  discardUnsavedImages: (doc: string) =>
    call<void>("discard_unsaved_images", { doc }, () => mock.discardUnsavedImages(doc)),
  /** An address the window can show a picture from (a library path). */
  imageUrl: (path: string) => (inTauri ? convertFileSrc(path, "qimg") : (mockImages.get(path) ?? "")),
};

/** Error text from Rust (a string) or the stand-in (an Error). */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
