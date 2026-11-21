/**
 * Discrete Letter-size pages, like real sheets of paper.
 *
 * The text stays one continuous ProseMirror document. When pages are on, we
 * measure where each printed page would end and insert invisible spacer
 * "widgets" that push the next line onto the next sheet. Spacers are view
 * decorations only: they are never saved and never part of the document.
 *
 * Breaks fall between lines, not just between paragraphs, so a long paragraph
 * flows from one sheet to the next exactly as it will print.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// Letter at 96 px per inch, 1 inch margins.
export const PAGE_W = 816;
export const PAGE_H = 1056;
export const MARGIN = 96;
export const CONTENT_H = PAGE_H - 2 * MARGIN;
export const GAP = 32; // desk visible between sheets

const key = new PluginKey<DecorationSet>("quillPages");

export const Pages = Extension.create({
  name: "pages",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(key) as DecorationSet | undefined;
            if (next) return next;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

interface Line {
  top: number; // relative to the content origin, in the layout without spacers
  bottom: number;
  breakPos: number; // where a spacer goes to start a page with this line
  inline: boolean; // spacer inside a paragraph (true) or between blocks (false)
}

function spacer(height: number, inline: boolean): HTMLElement {
  const el = document.createElement(inline ? "span" : "div");
  el.className = "page-gap";
  el.style.height = `${height}px`;
  el.setAttribute("contenteditable", "false");
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** Measure every line of text, in document order, in the current layout. */
function measureLines(view: EditorView, originTop: number, originLeft: number): Line[] {
  const lines: Line[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement)) return false;

    // Where a spacer goes to put this block's first line on a new sheet:
    // before the outermost ancestor this block opens, so a list bullet moves
    // together with its first line.
    const $pos = view.state.doc.resolve(pos);
    let blockStart = pos;
    for (let d = $pos.depth; d > 0 && $pos.index(d) === 0; d--) blockStart = $pos.before(d);

    const range = document.createRange();
    range.selectNodeContents(dom);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    if (rects.length === 0) {
      const r = dom.getBoundingClientRect();
      lines.push({ top: r.top - originTop, bottom: r.bottom - originTop, breakPos: blockStart, inline: false });
      return false;
    }
    // Merge fragments that share a line.
    const blockLines: { top: number; bottom: number; left: number }[] = [];
    for (const r of rects) {
      const last = blockLines[blockLines.length - 1];
      if (last && r.top < last.bottom - 2) {
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
        last.left = Math.min(last.left, r.left);
      } else {
        blockLines.push({ top: r.top, bottom: r.bottom, left: r.left });
      }
    }
    blockLines.forEach((l, i) => {
      let breakPos = blockStart;
      let inline = false;
      if (i > 0) {
        const hit = view.posAtCoords({ left: Math.max(originLeft, l.left) + 1, top: (l.top + l.bottom) / 2 });
        if (!hit) return;
        breakPos = hit.pos;
        inline = true;
      }
      lines.push({ top: l.top - originTop, bottom: l.bottom - originTop, breakPos, inline });
    });
    return false;
  });
  return lines;
}

export class PageController {
  enabled = false;
  pageCount = 1;
  private timer: number | undefined;
  private running = false;

  constructor(
    private view: () => EditorView,
    /** `shift`: how far the cursor moved down the page, so the view can follow it. */
    private onLayout: (pages: number, shift: number) => void,
  ) {}

  setEnabled(on: boolean) {
    this.enabled = on;
    this.recompute();
  }

  /** Recompute soon (coalesces bursts of typing). */
  schedule(delay = 120) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.recompute(), delay);
  }

  recompute() {
    clearTimeout(this.timer);
    const view = this.view();
    if (this.running || view.composing) return this.schedule(200);
    this.running = true;
    const head = view.state.selection.head;
    const before = view.coordsAtPos(head).top;
    const shift = () => view.coordsAtPos(Math.min(head, view.state.doc.content.size)).top - before;
    try {
      // 1. Lay the text out without spacers, then measure it. Both dispatches
      //    happen in the same task, so the browser never paints the bare layout.
      view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty).setMeta("addToHistory", false));
      if (!this.enabled) {
        this.pageCount = 1;
        this.onLayout(1, shift());
        return;
      }
      const root = view.dom as HTMLElement;
      const box = root.getBoundingClientRect();
      const originTop = box.top + MARGIN;
      const originLeft = box.left + MARGIN;
      const lines = measureLines(view, originTop, originLeft);

      // 2. Walk the lines, starting a new sheet whenever one would cross the
      //    bottom margin of the current sheet.
      const decos: Decoration[] = [];
      let pageStart = 0; // top of the first line on this sheet (bare layout)
      let page = 0;
      let added = 0; // total spacer height inserted so far
      for (const line of lines) {
        if (line.bottom > pageStart + CONTENT_H && line.top > pageStart) {
          page += 1;
          const target = page * (PAGE_H + GAP); // this sheet's first-line top
          const h = Math.max(0, target - (line.top + added));
          added += h;
          pageStart = line.top;
          decos.push(
            Decoration.widget(line.breakPos, () => spacer(h, line.inline), {
              side: -1,
              ignoreSelection: true,
              key: `gap-${page}-${Math.round(h)}`,
            }),
          );
        }
      }
      view.dispatch(
        view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)).setMeta("addToHistory", false),
      );
      this.pageCount = page + 1;
      this.onLayout(this.pageCount, shift());
    } finally {
      this.running = false;
    }
  }
}
