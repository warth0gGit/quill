import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Text colours and sizes are stored as palette *roles*, never as raw hex values,
 * so a document follows the light/dark theme and any future palette change.
 */
export const INK_ROLES = ["graphite", "midnight", "cobalt", "azure", "signal"] as const;
export type InkRole = (typeof INK_ROLES)[number];

export const SIZE_ROLES = ["small", "large", "title"] as const;
export type SizeRole = (typeof SIZE_ROLES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ink: {
      setInk: (role: InkRole) => ReturnType;
      unsetInk: () => ReturnType;
    };
    textSize: {
      setTextSize: (size: SizeRole) => ReturnType;
      unsetTextSize: () => ReturnType;
    };
  }
}

export const Ink = Mark.create({
  name: "ink",
  addAttributes() {
    return {
      role: {
        default: "graphite",
        parseHTML: (el) => el.getAttribute("data-ink"),
        renderHTML: (attrs) => ({ "data-ink": attrs.role }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-ink]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setInk:
        (role) =>
        ({ commands }) =>
          role === "graphite" ? commands.unsetMark(this.name) : commands.setMark(this.name, { role }),
      unsetInk:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const TextSize = Mark.create({
  name: "textSize",
  addAttributes() {
    return {
      size: {
        default: "large",
        parseHTML: (el) => el.getAttribute("data-size"),
        renderHTML: (attrs) => ({ "data-size": attrs.size }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-size]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setTextSize:
        (size) =>
        ({ commands }) =>
          commands.setMark(this.name, { size }),
      unsetTextSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
