/**
 * Pictures: paste, drop or choose a picture, and it lands between paragraphs.
 *
 * A picture is one block in the document (the "figure" node). Its attributes
 * say which file it shows (relative to the document's own folder, e.g.
 * "2026-11-21-091500 images/lake.png"), its layout (wrap left, centre, wrap
 * right or wide), its size (S, M, L or Full) and an optional caption.
 *
 * Wrapped pictures (left or right) are pinned where you put them: they keep
 * their place on the page while you write, and the text flows around them,
 * including text you add above. In the document they sit at the very start,
 * in order down the page, each with the height it's pinned at (`y`). Centred
 * and wide pictures sit between paragraphs and move with the text.
 *
 * Click a picture and the image bar appears above it. Drag it to move it to
 * another gap between paragraphs (and to the left, middle or right). Drag a
 * corner to resize it; sizes snap to the four widths. With a picture clicked,
 * the arrow keys change its layout and size, Delete removes it, and Enter or
 * Esc goes back to writing. Typing never replaces a picture.
 */
import { Node, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection, TextSelection, Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { library, joinPath, parentOf, errorText } from "./storage";
import { bar } from "./ui";
import { PAGE_H, GAP, MARGIN, CONTENT_H } from "./pages";

export type Align = "left" | "center" | "right" | "wide";
export type PicSize = "s" | "m" | "l" | "full";
const ALIGNS: Align[] = ["left", "center", "right", "wide"];
const SIZES: PicSize[] = ["s", "m", "l", "full"];
const ALIGN_NAMES: Record<Align, string> = { left: "Wrap left", center: "Centre", right: "Wrap right", wide: "Wide" };
const SIZE_NAMES: Record<PicSize, string> = { s: "S · Third", m: "M · Half", l: "L · Three quarters", full: "Full · Whole column" };
const SIZE_LABEL: Record<PicSize, string> = { s: "S", m: "M", l: "L", full: "Full" };
/** Picture widths as a share of the column; wrapped pictures stay narrower so text has room beside them. */
const WIDTH: Record<PicSize, number> = { s: 1 / 3, m: 0.5, l: 0.75, full: 1 };
const WRAP_WIDTH: Partial<Record<PicSize, number>> = { s: 0.3, m: 0.42, l: 0.55 };
const isWrap = (a: Align) => a === "left" || a === "right";
/** A wrapped picture pinned at a height on the page. */
const isPinned = (n: PMNode | null | undefined) => !!n && n.type.name === "figure" && isWrap(n.attrs.align) && n.attrs.y != null;

/** A picture copied from another document, waiting to be copied into this one's folder. */
const BORROWED = "lib:";

/* ------------------------------------------------------------ file <-> src */

/** The path we keep, from a picture's `src` in a file. Only plain relative paths count. */
export function fileFromSrc(src: string | null | undefined): string | null {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[\\/]/.test(src)) return null;
  let parts: string[];
  try {
    parts = src.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) return null;
  return parts.join("/");
}
const srcFromFile = (file: string) => file.split("/").map(encodeURIComponent).join("/");

/* ------------------------------------------------------------ what the page tells us */

interface Env {
  /** The open document's library path. */
  docPath: () => string;
  flash: (message: string) => void;
  /** Whether the page is shown as sheets of paper. */
  pages: () => boolean;
  /** A picture changed size or loaded: re-measure pages, move the bar. */
  layout: () => void;
}
let env: Env = { docPath: () => "", flash: () => undefined, pages: () => false, layout: () => undefined };

const urlFor = (file: string) =>
  file.startsWith(BORROWED) ? library.imageUrl(file.slice(BORROWED.length)) : library.imageUrl(joinPath(parentOf(env.docPath()), file));

/* ------------------------------------------------------------ the node */

const views = new Set<FigureView>();

export const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false, // moved with our own pointer handling, which knows about layouts
  addAttributes() {
    return {
      file: { default: "", parseHTML: (el) => fileFromSrc(el.querySelector("img")?.getAttribute("src")), renderHTML: () => ({}) },
      align: {
        default: "center",
        parseHTML: (el) => (ALIGNS as string[]).includes(el.dataset.align ?? "") ? el.dataset.align : "center",
        renderHTML: () => ({}),
      },
      size: {
        default: "l",
        parseHTML: (el) => (SIZES as string[]).includes(el.dataset.size ?? "") ? el.dataset.size : "l",
        renderHTML: () => ({}),
      },
      caption: {
        default: null,
        parseHTML: (el) => el.querySelector("figcaption")?.textContent?.trim() || null,
        renderHTML: () => ({}),
      },
      alt: { default: "", parseHTML: (el) => el.querySelector("img")?.getAttribute("alt") ?? "", renderHTML: () => ({}) },
      /** Where a wrapped picture is pinned: its top, in px below the top of the page. */
      y: {
        default: null,
        parseHTML: (el) => {
          const y = parseFloat(el.dataset.y ?? "");
          return Number.isFinite(y) ? Math.max(0, y) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "figure", getAttrs: (el) => (fileFromSrc((el as HTMLElement).querySelector("img")?.getAttribute("src")) ? null : false) }];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    const img = ["img", { src: srcFromFile(a.file), alt: a.alt || "" }];
    const attrs: Record<string, string> = { "data-align": a.align, "data-size": a.size };
    if (isPinned(node)) {
      attrs["data-y"] = String(Math.round(a.y));
      // So the saved file, opened in a browser, shows it where it was printed.
      const top = printTops.get(node);
      if (top != null) attrs.style = `margin-top:${top}px;shape-outside:inset(${top}px 0 0 0) margin-box`;
    }
    return a.caption ? ["figure", attrs, img, ["figcaption", {}, a.caption]] : ["figure", attrs, img];
  },
  renderText({ node }) {
    return node.attrs.caption ? `[${node.attrs.caption}]` : "";
  },
  addNodeView() {
    return ({ node, view, getPos }) => new FigureView(node, view, getPos);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [picturePlugin(editor)];
  },
});

/* ------------------------------------------------------------ how a picture is drawn */

class FigureView implements NodeView {
  dom: HTMLElement;
  frame: HTMLElement;
  img: HTMLImageElement;
  caption: HTMLElement;
  tag: HTMLElement;
  private shownFile = "";
  private shownUrl = "";

  constructor(
    public node: PMNode,
    public view: EditorView,
    public getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("figure");
    this.dom.className = "fig";
    this.dom.contentEditable = "false";
    this.frame = document.createElement("div");
    this.frame.className = "frame";
    this.img = document.createElement("img");
    this.img.draggable = false;
    this.img.decoding = "async";
    const hl = Object.assign(document.createElement("span"), { className: "h hl", title: "Drag to resize" });
    const hr = Object.assign(document.createElement("span"), { className: "h hr", title: "Drag to resize" });
    this.tag = Object.assign(document.createElement("span"), { className: "sizetag" });
    this.frame.append(this.img, hl, hr, this.tag);
    this.caption = document.createElement("figcaption");
    this.caption.dataset.ph = "Add a caption";
    this.caption.spellcheck = true;
    this.dom.append(this.frame, this.caption);

    this.img.addEventListener("load", () => {
      this.dom.classList.remove("missing");
      if (this.img.naturalWidth && this.img.naturalHeight) {
        this.dom.style.setProperty("--r", String(this.img.naturalWidth / this.img.naturalHeight));
      }
      placePinned(this.view, true);
      env.layout();
    });
    this.img.addEventListener("error", () => {
      this.dom.classList.add("missing");
      placePinned(this.view, true);
      env.layout();
    });
    this.dom.addEventListener("transitionend", (e) => {
      if (e.target === this.dom && isPinned(this.node)) placePinned(this.view, true);
    });
    this.frame.addEventListener("pointerdown", (e) => pointerDown(this, e));
    this.frame.addEventListener("pointermove", (e) => pointerMove(this, e));
    this.frame.addEventListener("pointerup", (e) => pointerUp(this, e));
    this.frame.addEventListener("pointercancel", (e) => pointerUp(this, e, true));
    this.frame.addEventListener("dragstart", (e) => e.preventDefault());

    // The caption is edited in place, as plain text.
    this.caption.addEventListener("input", () => this.setAttrs({ caption: this.caption.textContent ?? "" }, true));
    this.caption.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        const pos = this.getPos();
        if (pos != null) leave(this.view, pos);
      } else if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault(); // captions are plain text
      }
    });
    this.caption.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " ");
      document.execCommand("insertText", false, text);
    });
    this.caption.addEventListener("blur", () => {
      if (this.node.attrs.caption === "") this.render(); // keeps showing "Add a caption" while it's on
      placePinned(this.view, true);
      env.layout();
    });

    this.render();
    views.add(this);
  }

  render(force = false) {
    const a = this.node.attrs;
    this.dom.dataset.align = a.align;
    this.dom.dataset.size = a.size;
    this.dom.classList.toggle("pinned", isPinned(this.node));
    if (force || a.file !== this.shownFile || !this.shownUrl) {
      this.shownFile = a.file;
      this.shownUrl = urlFor(a.file);
      if (this.shownUrl) this.img.src = this.shownUrl;
      else this.dom.classList.add("missing");
    }
    this.img.alt = a.alt || "Picture";
    const on = a.caption !== null;
    this.dom.classList.toggle("cap", on);
    this.caption.contentEditable = on ? "true" : "false";
    if (document.activeElement !== this.caption && (this.caption.textContent ?? "") !== (a.caption ?? "")) {
      this.caption.textContent = a.caption ?? "";
    }
  }

  /** Change this picture's attributes in the document. */
  setAttrs(patch: Record<string, unknown>, history = true) {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch });
    if (this.view.state.selection instanceof NodeSelection && this.view.state.selection.from === pos) {
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    }
    if (!history) tr.setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() {
    this.dom.classList.add("sel");
  }
  deselectNode() {
    this.dom.classList.remove("sel");
  }
  stopEvent(e: Event) {
    const t = e.target as globalThis.Node | null;
    if (!t) return false;
    if (this.caption.contains(t)) return true; // typing in the caption is ours, not ProseMirror's
    // Clicks and drags on the picture are handled here, not by ProseMirror.
    return this.frame.contains(t) && /^(pointer|mouse|click|dblclick|drag|touch)/.test(e.type);
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    views.delete(this);
  }
}

/* ------------------------------------------------------------ selection */

/** The picture that's selected, if one is. */
function selectedFigure(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  return sel instanceof NodeSelection && sel.node.type.name === "figure" ? { node: sel.node, pos: sel.from } : null;
}

/**
 * The arrow keys change a picture's layout only when you clicked it (or it
 * just arrived). A picture you reach with the arrow keys while moving through
 * the text lets the arrows carry on past it.
 */
let active: number | null = null;
/** Where the cursor was before a picture was pasted, so typing carries on there. */
let arrival: { figure: number; back: number } | null = null;

function selectFigure(view: EditorView, pos: number, tr: Transaction = view.state.tr) {
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  active = pos;
  if (!view.hasFocus()) view.focus();
}

/** Put the cursor at the start of the text after the picture at `pos`, making a paragraph if there isn't one. */
function leave(view: EditorView, pos: number, tr: Transaction = view.state.tr) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  if (isPinned(node)) {
    // A pinned picture: the cursor goes into the text beside it.
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    let sel: Selection | null = null;
    if (dom) {
      const r = dom.getBoundingClientRect();
      const col = column(view);
      const x = node.attrs.align === "left" ? Math.min(r.right + 30, col.left + col.width - 2) : Math.max(r.left - 30, col.left + 2);
      const hit = view.posAtCoords({ left: x, top: r.top + 10 });
      if (hit) {
        const near = Selection.near(tr.doc.resolve(hit.pos));
        if (near instanceof TextSelection) sel = near;
      }
    }
    tr.setSelection(sel ?? Selection.atEnd(tr.doc));
    view.dispatch(tr);
    view.focus();
    return;
  }
  const after = pos + node.nodeSize;
  const next = tr.doc.nodeAt(after);
  if (!next || !next.isTextblock) tr.insert(after, view.state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

/* ------------------------------------------------------------ pinned pictures */

/*
 * A pinned picture's `y` is measured on "paper": the writing as one long
 * strip, with the sheets' margins and the gaps between them taken out. That is
 * exactly where it prints, and it stays put whether or not pages are shown.
 */
const STEP = PAGE_H + GAP;
/** From paper to the page on screen (px below the top of the editor). */
function screenY(paper: number): number {
  if (!env.pages()) return paper;
  const s = Math.floor(Math.max(0, paper) / CONTENT_H);
  return s * STEP + MARGIN + (paper - s * CONTENT_H);
}
/** From the page on screen to paper. */
function paperY(screen: number): number {
  if (!env.pages()) return Math.max(0, screen);
  const s = Math.max(0, Math.floor(screen / STEP));
  const within = Math.min(CONTENT_H, Math.max(0, screen - s * STEP - MARGIN));
  return s * CONTENT_H + within;
}
/** On sheets, a picture never hangs over a sheet's edge: it moves up to fit, or onto the next sheet if it's in the bottom margin. */
function onSheet(y: number, h: number): number {
  if (!env.pages()) return Math.max(0, y);
  let s = Math.max(0, Math.floor(y / STEP));
  if (y > s * STEP + MARGIN + CONTENT_H) s += 1;
  const lo = s * STEP + MARGIN;
  return Math.max(lo, Math.min(y, lo + CONTENT_H - h));
}

const edTop = (view: EditorView) => (view.dom as HTMLElement).getBoundingClientRect().top;

/** A picture's top on paper, as it's shown now. */
function paperTopOf(view: EditorView, pos: number): number | null {
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  return dom?.getBoundingClientRect ? Math.round(paperY(dom.getBoundingClientRect().top - edTop(view))) : null;
}

/** Where the saved file (and the printout) puts each pinned picture: its top margin. */
const printTops = new WeakMap<PMNode, number>();
let pinnedKey = "";

/**
 * Put each pinned picture at its height. The pictures all sit at the start of
 * the document, so a top margin takes each one down to its place, and the text
 * steps around the picture only, not around the margin above it.
 */
function placePinned(view: EditorView, force = false) {
  const pinned: { fv: FigureView; y: number }[] = [];
  view.state.doc.forEach((n, pos) => {
    if (!isPinned(n)) return;
    const dom = view.nodeDOM(pos);
    const fv = [...views].find((v) => v.dom === dom);
    if (fv) pinned.push({ fv, y: n.attrs.y });
  });
  const key = [env.pages(), (view.dom as HTMLElement).clientWidth, ...pinned.map(({ fv, y }) => {
    const a = fv.node.attrs;
    return `${y},${a.align},${a.size},${a.caption ?? "-"},${a.file}`;
  })].join("|");
  if (!force && key === pinnedKey) return;
  pinnedKey = key;
  if (!pinned.length) return;
  const top0 = edTop(view);
  const printed = { left: 0, right: 0 };
  for (const { fv, y } of pinned) {
    const el = fv.dom;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const natural = r.top - top0 - (parseFloat(cs.marginTop) || 0);
    const at = onSheet(screenY(y), r.height);
    el.style.setProperty("--mt", `${Math.max(0, at - natural)}px`);
    // Printed, the same picture sits on paper, with nothing above it but the pictures before it.
    const side = fv.node.attrs.align as "left" | "right";
    const py = paperY(at);
    const pm = Math.round(Math.max(0, py - printed[side]));
    el.style.setProperty("--mtp", `${pm}px`);
    printTops.set(fv.node, pm);
    printed[side] = Math.max(printed[side], py) + r.height + (parseFloat(cs.marginBottom) || 0);
  }
  env.layout();
}

/** Where a pinned picture at paper height `y` goes among the others at the start of the document. */
function pinnedSlot(doc: PMNode, y: number, skip: number | null): number {
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const c = doc.child(i);
    if (pos !== skip) {
      if (!isPinned(c) || c.attrs.y > y) return pos;
    }
    pos += c.nodeSize;
  }
  return pos;
}

/** Where a picture that stops wrapping goes: before the first paragraph at or below its height, never above the title. */
function flowSlot(view: EditorView, paper: number): number {
  const y = screenY(paper);
  const top0 = edTop(view);
  let seenTitle = false;
  let slot = view.state.doc.content.size;
  let found = false;
  view.state.doc.forEach((n, pos) => {
    if (found || isPinned(n)) return;
    if (!seenTitle) return void (seenTitle = true);
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    const t = dom?.getBoundingClientRect ? dom.getBoundingClientRect().top - top0 : Infinity;
    if (t >= y - 4) {
      slot = pos;
      found = true;
    }
  });
  return slot;
}

/**
 * Give the picture at `pos` new attributes in `tr` (which must not have
 * changed the document yet), moving it if it starts or stops wrapping. A
 * picture that starts wrapping is pinned where it is (or at paper height `y`);
 * one that stops goes back between the paragraphs at its height. Returns
 * where the picture is now.
 */
function relayoutFigure(view: EditorView, tr: Transaction, pos: number, next: PMNode["attrs"], y?: number): number {
  const node = tr.doc.nodeAt(pos)!;
  const was = isPinned(node);
  if (isWrap(next.align)) {
    const at = Math.max(0, Math.round(y ?? (was ? node.attrs.y : paperTopOf(view, pos) ?? 0)));
    const attrs = { ...next, y: at };
    const slot = pinnedSlot(tr.doc, at, was ? pos : null);
    if (was && (slot === pos || slot === pos + node.nodeSize)) {
      tr.setNodeMarkup(pos, undefined, attrs);
      return pos;
    }
    tr.delete(pos, pos + node.nodeSize);
    const to = tr.mapping.map(slot);
    tr.insert(to, node.type.create(attrs));
    return to;
  }
  const attrs = { ...next, y: null };
  if (!was) {
    tr.setNodeMarkup(pos, undefined, attrs);
    return pos;
  }
  const slot = flowSlot(view, y ?? node.attrs.y);
  tr.delete(pos, pos + node.nodeSize);
  const to = tr.mapping.map(slot);
  tr.insert(to, node.type.create(attrs));
  return to;
}

/** Pictures wrapped before pinning existed (or pasted in) are pinned where they are now. */
function pinLoose(view: EditorView) {
  const loose: { pos: number; node: PMNode; y: number }[] = [];
  view.state.doc.forEach((n, pos) => {
    if (n.type.name === "figure" && isWrap(n.attrs.align) && n.attrs.y == null) loose.push({ pos, node: n, y: paperTopOf(view, pos) ?? 0 });
  });
  if (!loose.length) return;
  const tr = view.state.tr.setMeta("addToHistory", false);
  for (const l of [...loose].reverse()) tr.delete(l.pos, l.pos + l.node.nodeSize);
  for (const l of loose) tr.insert(pinnedSlot(tr.doc, l.y, null), l.node.type.create({ ...l.node.attrs, y: l.y }));
  view.dispatch(tr);
}

/* ------------------------------------------------------------ layout and size */

function withAlign(attrs: PMNode["attrs"], align: Align) {
  let size = attrs.size as PicSize;
  if (isWrap(align) && size === "full") size = "l";
  return { ...attrs, align, size };
}
function withSize(attrs: PMNode["attrs"], size: PicSize) {
  let align = attrs.align as Align;
  if (align === "wide" || (isWrap(align) && size === "full")) align = "center";
  return { ...attrs, align, size };
}
/** One step bigger or smaller: S, M, L, Full and then Wide (wrapped pictures stop at L). */
function stepped(attrs: PMNode["attrs"], dir: 1 | -1) {
  const align = attrs.align as Align;
  if (align === "wide") return dir < 0 ? { ...attrs, align: "center", size: "full" } : attrs;
  const i = SIZES.indexOf(attrs.size as PicSize) + dir;
  const max = isWrap(align) ? 2 : 3;
  if (i > max) return isWrap(align) ? attrs : { ...attrs, align: "wide" };
  return i >= 0 ? { ...attrs, size: SIZES[i] } : attrs;
}

function changeSelected(view: EditorView, make: (attrs: PMNode["attrs"]) => PMNode["attrs"]) {
  const fig = selectedFigure(view.state);
  if (!fig) return;
  const tr = view.state.tr;
  const pos = relayoutFigure(view, tr, fig.pos, make(fig.node.attrs));
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  active = pos;
  view.focus();
}

/* ------------------------------------------------------------ where a picture lands */

interface Target {
  pos: number; // a gap between top-level blocks
  zone: Align;
  lineY: number;
  /** For wrapping: the paper height the picture's top is pinned at. */
  y: number;
}

const dropEl = document.createElement("div");
dropEl.className = "pic-drop";
dropEl.innerHTML = "<i></i><span></span>";
document.body.appendChild(dropEl);

/** The writing column, without the page's padding. */
function column(view: EditorView) {
  const r = (view.dom as HTMLElement).getBoundingClientRect();
  const cs = getComputedStyle(view.dom as HTMLElement);
  const left = r.left + parseFloat(cs.paddingLeft);
  const width = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return { left, width, top: r.top + parseFloat(cs.paddingTop) };
}

/**
 * The gap between paragraphs nearest to (x, y), and whether the picture should
 * wrap left, sit in the centre or wrap right. A wrapped picture isn't put in a
 * gap: it's pinned with its top at the pointer (less `grabDy`, how far down the
 * picture you're holding it). Never above the first line, which is the title.
 * Shows the glowing line where it will land.
 */
function targetAt(view: EditorView, x: number, y: number, exclude: number | null, keepWide: boolean, grabDy = 0): Target {
  const col = column(view);
  const rel = (x - col.left) / col.width;
  let zone: Align = rel < 0.3 ? "left" : rel > 0.7 ? "right" : "center";
  if (zone === "center" && keepWide) zone = "wide";

  const blocks: { pos: number; top: number; bottom: number }[] = [];
  view.state.doc.forEach((node, pos) => {
    if (pos === exclude || isPinned(node)) return;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom?.getBoundingClientRect) return;
    const r = dom.getBoundingClientRect();
    blocks.push({ pos, top: r.top, bottom: r.bottom });
  });
  let pos = view.state.doc.content.size;
  let lineY = blocks.length ? blocks[blocks.length - 1].bottom + 6 : col.top;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (y < (b.top + b.bottom) / 2) {
      if (i === 0) {
        // never above the title
        pos = blocks[1]?.pos ?? view.state.doc.content.size;
        lineY = blocks[1] ? (b.bottom + blocks[1].top) / 2 : b.bottom + 6;
      } else {
        pos = b.pos;
        lineY = (blocks[i - 1].bottom + b.top) / 2;
      }
      break;
    }
  }
  let pinY = 0;
  if (isWrap(zone)) {
    const top0 = edTop(view);
    const below = blocks.length ? blocks[0].bottom + 4 : col.top; // under the title
    lineY = Math.max(below, y - grabDy);
    pinY = Math.round(paperY(lineY - top0));
    lineY = screenY(pinY) + top0;
  }
  const span: Record<Align, [number, number]> = { left: [0, 0.42], center: [0.2, 0.8], right: [0.58, 1], wide: [-0.08, 1.08] };
  const [a, b] = span[zone];
  dropEl.style.transform = `translate(${col.left}px, ${lineY}px)`;
  dropEl.style.width = `${col.width}px`;
  const line = dropEl.firstElementChild as HTMLElement;
  line.style.left = `${a * col.width}px`;
  line.style.width = `${(b - a) * col.width}px`;
  const label = dropEl.lastElementChild as HTMLElement;
  label.style.left = `${((a + b) / 2) * col.width}px`;
  label.textContent = ALIGN_NAMES[zone];
  dropEl.classList.add("on");
  return { pos, zone, lineY, y: pinY };
}
const hideDrop = () => dropEl.classList.remove("on");

/** Where a pasted or chosen picture goes: below the paragraph the cursor is in, or in place of an empty line. */
function defaultSpot(state: EditorState): number {
  const sel = state.selection;
  const $from = sel.$from;
  if ($from.depth === 0) return sel.to;
  const index = $from.index(0);
  const block = state.doc.child(index);
  const start = $from.before(1);
  if (block.type.name === "paragraph" && block.content.size === 0 && index > 0) return start;
  return $from.after(1);
}

/* ------------------------------------------------------------ bringing pictures in */

const isImage = (f: File) => /^image\//.test(f.type);

async function insertFiles(editor: Editor, files: File[], at?: Target) {
  const doc = env.docPath();
  const pics = files.filter(isImage);
  if (!pics.length) {
    if (files.length) env.flash("That isn't a picture Quill can show (try PNG, JPEG, GIF or WebP)");
    return;
  }
  const saved: string[] = [];
  for (const f of pics) {
    try {
      saved.push(await library.saveImage(doc, f, f.name));
    } catch (e) {
      env.flash(errorText(e));
    }
  }
  if (!saved.length || env.docPath() !== doc) return; // another document was opened meanwhile
  const { view, state } = editor;
  const type = state.schema.nodes.figure;
  const zone = at?.zone ?? "center";
  const back = state.selection.empty ? state.selection.head : null;
  const tr = state.tr;
  let pos: number;
  if (at && isWrap(zone)) {
    // Dropped to one side: pinned where it was dropped (several stack down the page).
    pos = -1;
    for (const file of saved) {
      const node = type.create({ align: zone, size: "m", file, y: at.y });
      const slot = pinnedSlot(tr.doc, at.y + 0.5, null);
      tr.insert(slot, node);
      if (pos < 0) pos = slot;
    }
  } else {
    const attrs = isWrap(zone) ? { align: zone, size: "m" } : { align: "center", size: "l" };
    const nodes = saved.map((file) => type.create({ ...attrs, file }));
    pos = Math.min(at?.pos ?? defaultSpot(state), state.doc.content.size);
    tr.insert(pos, Fragment.from(nodes));
  }
  selectFigure(view, pos, tr);
  arrival = back != null && !at ? { figure: pos, back: tr.mapping.map(back) } : null;
  // A soft glow as it arrives, then make sure it's in view.
  requestAnimationFrame(() => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return;
    dom.classList.add("arrive");
    setTimeout(() => dom.classList.remove("arrive"), 700);
    const r = dom.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight - 40) dom.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

let picker: HTMLInputElement | null = null;
function pick(onFiles: (files: File[]) => void, multiple = true) {
  picker?.remove();
  picker = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple, hidden: true });
  document.body.appendChild(picker);
  picker.addEventListener("change", () => {
    const files = [...(picker?.files ?? [])];
    picker?.remove();
    picker = null;
    if (files.length) onFiles(files);
  });
  picker.click();
}

/* ------------------------------------------------------------ dragging and resizing */

type Drag =
  | { kind: "maybe"; fv: FigureView; x0: number; y0: number; grabDy: number }
  | { kind: "move"; fv: FigureView; ghost: HTMLImageElement; target: Target | null; grabDy: number }
  | { kind: "resize"; fv: FigureView; side: 1 | -1; x0: number; w0: number; align: Align; size: PicSize };
let drag: Drag | null = null;

function pointerDown(fv: FigureView, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  const pos = fv.getPos();
  if (pos == null) return;
  arrival = null; // clicked on purpose: typing now goes after it
  selectFigure(fv.view, pos);
  fv.frame.setPointerCapture(e.pointerId);
  const handle = (e.target as HTMLElement).closest(".h");
  if (handle) {
    drag = {
      kind: "resize",
      fv,
      side: handle.classList.contains("hl") ? -1 : 1,
      x0: e.clientX,
      w0: fv.frame.getBoundingClientRect().width,
      align: fv.node.attrs.align,
      size: fv.node.attrs.size,
    };
    fv.dom.classList.add("resizing");
    showSizeTag(fv, drag.align, drag.size);
  } else {
    drag = { kind: "maybe", fv, x0: e.clientX, y0: e.clientY, grabDy: e.clientY - fv.dom.getBoundingClientRect().top };
  }
}

function showSizeTag(fv: FigureView, align: Align, size: PicSize) {
  fv.tag.textContent = align === "wide" ? "Wide" : SIZE_NAMES[size];
}

function pointerMove(fv: FigureView, e: PointerEvent) {
  if (!drag || drag.fv !== fv) return;
  if (drag.kind === "maybe" && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) {
    const ghost = Object.assign(document.createElement("img"), { className: "pic-ghost", src: fv.img.src, alt: "" });
    document.body.appendChild(ghost);
    fv.dom.classList.add("lifting");
    imageBar.el.classList.remove("on");
    drag = { kind: "move", fv, ghost, target: null, grabDy: drag.grabDy };
  }
  if (drag.kind === "move") {
    drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%) rotate(-2deg)`;
    drag.target = targetAt(fv.view, e.clientX, e.clientY, fv.getPos() ?? null, fv.node.attrs.align === "wide", drag.grabDy);
    autoScroll(fv.view, e.clientY);
  } else if (drag.kind === "resize") {
    const col = column(fv.view).width;
    const wrap = isWrap(fv.node.attrs.align);
    const grow = (e.clientX - drag.x0) * drag.side * (wrap ? 1 : 2);
    const frac = (drag.w0 + grow) / col;
    let align: Align = fv.node.attrs.align === "wide" ? "center" : fv.node.attrs.align;
    let size: PicSize = drag.size;
    if (!wrap && frac > 1.08) {
      align = "wide";
      size = "full";
    } else {
      const options = SIZES.filter((s) => !wrap || s !== "full");
      const width = (s: PicSize) => (wrap ? WRAP_WIDTH[s]! : WIDTH[s]);
      size = options.reduce((best, s) => (Math.abs(width(s) - frac) < Math.abs(width(best) - frac) ? s : best));
    }
    if (align !== drag.align || size !== drag.size) {
      drag.align = align;
      drag.size = size;
      fv.dom.dataset.align = align;
      fv.dom.dataset.size = size;
      showSizeTag(fv, align, size);
      placeBar(fv.view);
    }
  }
}

function pointerUp(fv: FigureView, _e: PointerEvent, cancelled = false) {
  if (!drag || drag.fv !== fv) return;
  const d = drag;
  drag = null;
  const view = fv.view;
  const pos = fv.getPos();
  if (d.kind === "move") {
    d.ghost.remove();
    fv.dom.classList.remove("lifting");
    hideDrop();
    if (pos == null || cancelled || !d.target) return void updateBar(view);
    const node = view.state.doc.nodeAt(pos)!;
    const zone = d.target.zone;
    const attrs = zone === "wide" || zone !== node.attrs.align ? withAlign(node.attrs, zone) : node.attrs;
    const tr = view.state.tr;
    let at = d.target.pos;
    if (isWrap(zone)) {
      at = relayoutFigure(view, tr, pos, attrs, d.target.y);
    } else if (at !== pos && at !== pos + node.nodeSize) {
      tr.delete(pos, pos + node.nodeSize);
      at = tr.mapping.map(at);
      tr.insert(at, node.type.create({ ...attrs, y: null }));
    } else {
      at = pos;
      tr.setNodeMarkup(pos, undefined, { ...attrs, y: null });
    }
    selectFigure(view, at, tr);
  } else if (d.kind === "resize") {
    fv.dom.classList.remove("resizing");
    if (pos == null || cancelled) return void fv.render();
    if (d.align !== fv.node.attrs.align || d.size !== fv.node.attrs.size) {
      selectFigure(view, pos, view.state.tr.setNodeMarkup(pos, undefined, { ...fv.node.attrs, align: d.align, size: d.size }));
    }
  }
  env.layout();
}

function autoScroll(view: EditorView, y: number) {
  const scroller = (view.dom as HTMLElement).closest(".page") as HTMLElement | null;
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  if (y < r.top + 48) scroller.scrollTop -= 14;
  else if (y > r.bottom - 48) scroller.scrollTop += 14;
}

/* ------------------------------------------------------------ the image bar */

const ico = (body: string) =>
  `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${body}</svg>`;
const ALIGN_ICONS: Record<Align, string> = {
  left: ico('<rect x="2" y="4" width="7" height="6" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M11.5 5h4.5M11.5 8h4.5M2 13h14M2 16h10"/>'),
  center: ico('<path d="M2 2.5h14"/><rect x="4.5" y="5.5" width="9" height="7" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M2 15.5h14"/>'),
  right: ico('<rect x="9" y="4" width="7" height="6" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M2 5h4.5M2 8h4.5M2 13h14M6 16h10"/>'),
  wide: ico('<path d="M4 2.5h10"/><rect x="1" y="5.5" width="16" height="7" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M4 15.5h10"/>'),
};

let barView: EditorView | null = null;
const imageBar = (() => {
  const B = bar("imgbar", "Picture");
  B.tag("Picture");
  const aligns = ALIGNS.map((a) =>
    B.button(ALIGN_ICONS[a], `${ALIGN_NAMES[a]} (← →)`, () => barView && changeSelected(barView, (at) => withAlign(at, a))),
  );
  B.sep();
  const sizes = SIZES.map((s) =>
    B.button(`<span class="pic-size">${SIZE_LABEL[s]}</span>`, `${SIZE_NAMES[s]} (↑ ↓)`, () => barView && changeSelected(barView, (at) => withSize(at, s))),
  );
  B.sep();
  const caption = B.button('<span class="pic-word">Caption</span>', "Show or hide a caption", () => {
    const view = barView;
    const fig = view && selectedFigure(view.state);
    if (!view || !fig) return;
    const on = fig.node.attrs.caption === null;
    changeSelected(view, (at) => ({ ...at, caption: on ? "" : null }));
    if (on) {
      const fv = [...views].find((v) => v.getPos() === fig.pos);
      if (fv) {
        fv.caption.focus();
        getSelection()?.selectAllChildren(fv.caption);
        getSelection()?.collapseToEnd();
      }
    }
  });
  B.button('<span class="pic-word">Replace</span>', "Replace with another picture", () => {
    const view = barView;
    const fig = view && selectedFigure(view.state);
    if (!view || !fig) return;
    const doc = env.docPath();
    pick(async ([f]) => {
      try {
        const file = await library.saveImage(doc, f, f.name);
        if (env.docPath() !== doc) return;
        const node = view.state.doc.nodeAt(fig.pos);
        if (node?.type.name !== "figure") return;
        selectFigure(view, fig.pos, view.state.tr.setNodeMarkup(fig.pos, undefined, { ...node.attrs, file, alt: "" }));
      } catch (e) {
        env.flash(errorText(e));
      }
    }, false);
  });
  const remove = B.button('<span class="clear">×</span>', "Remove picture (Delete)", () => {
    const view = barView;
    const fig = view && selectedFigure(view.state);
    if (!view || !fig) return;
    const tr = view.state.tr.delete(fig.pos, fig.pos + fig.node.nodeSize);
    const at = Math.min(fig.pos, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
    view.dispatch(tr);
    view.focus();
  });
  remove.classList.add("danger");
  return { el: B.el, aligns, sizes, caption };
})();

function updateBar(view: EditorView) {
  barView = view;
  const fig = selectedFigure(view.state);
  const focused = view.dom.contains(document.activeElement);
  if (!fig || !focused || drag?.kind === "move") {
    imageBar.el.classList.remove("on");
    return;
  }
  const { align, size, caption } = fig.node.attrs;
  imageBar.aligns.forEach((b, i) => b.setAttribute("aria-pressed", String(ALIGNS[i] === align)));
  imageBar.sizes.forEach((b, i) => b.setAttribute("aria-pressed", String(align !== "wide" && SIZES[i] === size)));
  imageBar.sizes[3].disabled = isWrap(align);
  imageBar.caption.setAttribute("aria-pressed", String(caption !== null));
  placeBar(view);
  imageBar.el.classList.add("on");
}

function placeBar(view: EditorView) {
  const fig = selectedFigure(view.state);
  const dom = fig && (view.nodeDOM(fig.pos) as HTMLElement | null);
  const frame = dom?.querySelector(".frame");
  if (!frame) return;
  const r = frame.getBoundingClientRect();
  const w = imageBar.el.offsetWidth;
  const h = imageBar.el.offsetHeight;
  const left = Math.max(8, Math.min((r.left + r.right) / 2 - w / 2, innerWidth - w - 8));
  let top = r.top - h - 12;
  if (top < 52) top = r.bottom + 12;
  if (top > innerHeight - h - 12) top = Math.max(52, Math.min(r.top + 12, innerHeight - h - 12));
  imageBar.el.style.transform = `translate(${left}px, ${top}px)`;
}

/* ------------------------------------------------------------ the plugin */

let copiedFrom: string | null = null;

/**
 * Pictures copied from another document point into that document's folder.
 * They're marked as borrowed when pasted, then copied into this document's
 * own folder in the background (and again on opening, if that was cut short).
 */
async function settleBorrowed(editor: Editor) {
  const borrowed = new Set<string>();
  editor.state.doc.forEach((n) => {
    if (n.type.name === "figure" && String(n.attrs.file).startsWith(BORROWED)) borrowed.add(n.attrs.file);
  });
  const doc = env.docPath();
  for (const b of borrowed) {
    let file: string;
    try {
      file = await library.copyImage(b.slice(BORROWED.length), doc);
    } catch {
      continue; // leave it pointing at the original
    }
    if (env.docPath() !== doc) return;
    const tr = editor.state.tr.setMeta("addToHistory", false);
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "figure" && n.attrs.file === b) tr.setNodeMarkup(pos, undefined, { ...n.attrs, file });
    });
    if (tr.docChanged) {
      const sel = editor.state.selection;
      if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from));
      editor.view.dispatch(tr);
    }
  }
}

function picturePlugin(editor: Editor) {
  return new Plugin({
    key: new PluginKey("quillPictures"),
    view: (view) => {
      const onCopy = () => (copiedFrom = env.docPath());
      view.dom.addEventListener("copy", onCopy);
      view.dom.addEventListener("cut", onCopy);
      return {
        update(v) {
          const fig = selectedFigure(v.state);
          if (!fig || fig.pos !== active) active = null;
          if (!fig || fig.pos !== arrival?.figure) arrival = null;
          placePinned(v);
          updateBar(v);
        },
        destroy() {
          view.dom.removeEventListener("copy", onCopy);
          view.dom.removeEventListener("cut", onCopy);
        },
      };
    },
    props: {
      handleKeyDown(view, e) {
        // Pinned pictures sit before the title in the document: the cursor
        // never goes back into them from the title, and Backspace doesn't join them.
        if (!e.isComposing && (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowUp")) {
          const { selection: sel, doc } = view.state;
          const $from = sel.$from;
          if (sel.empty && $from.depth >= 1 && $from.index(0) > 0 && isPinned(doc.child($from.index(0) - 1))) {
            const atStart = $from.depth === 1 && $from.parentOffset === 0;
            if (e.key === "ArrowUp" ? view.endOfTextblock("up") : atStart) return true;
          }
        }
        const fig = selectedFigure(view.state);
        if (!fig || e.isComposing) return false;
        const mod = e.ctrlKey || e.metaKey || e.altKey;
        if (!mod && (e.key === "Enter" || e.key === "Escape")) {
          leave(view, fig.pos);
          return true;
        }
        // Typing with a picture selected writes after it (or back where you
        // were, if the picture was just pasted), never over it.
        if (!mod && e.key.length === 1) {
          const tr = view.state.tr;
          if (arrival && arrival.figure === fig.pos) {
            tr.setSelection(TextSelection.create(tr.doc, Math.min(arrival.back, tr.doc.content.size)));
            view.dispatch(tr.insertText(e.key).scrollIntoView());
          } else {
            leave(view, fig.pos, tr);
            view.dispatch(view.state.tr.insertText(e.key).scrollIntoView());
          }
          return true;
        }
        if (mod || active !== fig.pos) return false;
        const order: Align[] = ["left", "center", "right"];
        const a = fig.node.attrs.align === "wide" ? "center" : (fig.node.attrs.align as Align);
        const i = order.indexOf(a);
        if (e.key === "ArrowLeft") changeSelected(view, (at) => withAlign(at, order[Math.max(0, i - 1)]));
        else if (e.key === "ArrowRight") changeSelected(view, (at) => withAlign(at, order[Math.min(2, i + 1)]));
        else if (e.key === "ArrowUp") changeSelected(view, (at) => stepped(at, 1));
        else if (e.key === "ArrowDown") changeSelected(view, (at) => stepped(at, -1));
        else return false;
        env.layout();
        return true;
      },
      handlePaste(_view, e) {
        const data = e.clipboardData;
        if (!data) return false;
        let files = [...data.files].filter(isImage);
        if (!files.length) {
          files = [...data.items].filter((i) => i.kind === "file" && /^image\//.test(i.type)).map((i) => i.getAsFile()!).filter(Boolean);
        }
        if (!files.length) return false;
        // Word and Excel put a picture of copied text on the clipboard too:
        // when there's text, the text is what you meant.
        if (/\S/.test(data.getData("text/plain"))) return false;
        void insertFiles(editor, files);
        return true;
      },
      transformPasted(slice) {
        // A pasted picture comes in between paragraphs, centred: a pinned
        // height from elsewhere would mean nothing here.
        let unpinned = false;
        const unpin = (frag: Fragment): Fragment => {
          const out: PMNode[] = [];
          frag.forEach((n) => {
            if (n.type.name === "figure" && (isWrap(n.attrs.align) || n.attrs.y != null)) {
              unpinned = true;
              out.push(n.type.create({ ...n.attrs, align: "center", size: n.attrs.size === "s" ? "s" : "m", y: null }));
            } else out.push(n.copy(unpin(n.content)));
          });
          return Fragment.from(out);
        };
        const flat = unpin(slice.content);
        if (unpinned) slice = new Slice(flat, slice.openStart, slice.openEnd);
        if (!copiedFrom || copiedFrom === env.docPath()) return slice;
        const from = parentOf(copiedFrom);
        let changed = false;
        const map = (frag: Fragment): Fragment => {
          const out: PMNode[] = [];
          frag.forEach((n) => {
            if (n.type.name === "figure" && n.attrs.file && !String(n.attrs.file).startsWith(BORROWED)) {
              changed = true;
              out.push(n.type.create({ ...n.attrs, file: BORROWED + joinPath(from, n.attrs.file) }));
            } else out.push(n.copy(map(n.content)));
          });
          return Fragment.from(out);
        };
        const next = new Slice(map(slice.content), slice.openStart, slice.openEnd);
        if (!changed) return slice;
        setTimeout(() => void settleBorrowed(editor), 0);
        return next;
      },
    },
  });
}

/* ------------------------------------------------------------ setup */

export interface Pictures {
  /** Opens the file picker; the pictures go in below the cursor. */
  choose(): void;
  /** Re-resolve every picture's address (the document moved). */
  refresh(): void;
  /** The document was renamed: its pictures folder was renamed to match. */
  renameFolder(from: string, to: string): void;
  /** After opening a document: finish copying any borrowed pictures, and pin wrapped pictures from older files. */
  settle(): void;
  /** The page changed shape (pages on or off): put pinned pictures back at their heights. */
  relayout(): void;
}

export function setupPictures(editor: Editor, page: HTMLElement, deps: Env): Pictures {
  env = deps;
  const view = () => editor.view;

  // Dropping picture files from File Explorer anywhere on the page.
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  page.addEventListener(
    "dragover",
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "copy";
      targetAt(view(), e.clientX, e.clientY, null, false);
    },
    true,
  );
  page.addEventListener("dragleave", (e) => {
    if (!page.contains(e.relatedTarget as globalThis.Node | null)) hideDrop();
  });
  page.addEventListener(
    "drop",
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const t = targetAt(view(), e.clientX, e.clientY, null, false);
      hideDrop();
      void insertFiles(editor, [...e.dataTransfer!.files], t);
    },
    true,
  );
  // A file dropped anywhere else must never replace the whole window.
  for (const type of ["dragover", "drop"] as const) {
    addEventListener(type, (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        if (type === "drop") hideDrop();
      }
    });
  }

  page.addEventListener("scroll", () => !drag && placeBar(view()), { passive: true });
  addEventListener("resize", () => {
    placePinned(view());
    placeBar(view());
  });
  editor.on("focus", () => updateBar(view()));
  editor.on("blur", () => setTimeout(() => updateBar(view()), 0));

  return {
    choose: () => pick((files) => void insertFiles(editor, files)),
    refresh: () => views.forEach((v) => v.render(true)),
    renameFolder(from, to) {
      const tr = editor.state.tr.setMeta("addToHistory", false);
      editor.state.doc.forEach((n, pos) => {
        if (n.type.name === "figure" && String(n.attrs.file).startsWith(from + "/")) {
          tr.setNodeMarkup(pos, undefined, { ...n.attrs, file: to + String(n.attrs.file).slice(from.length) });
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
      views.forEach((v) => v.render(true));
    },
    settle: () => {
      void settleBorrowed(editor);
      requestAnimationFrame(() => pinLoose(view()));
    },
    relayout: () => placePinned(view(), true),
  };
}
