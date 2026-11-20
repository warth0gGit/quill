/**
 * Saving documents. Inside the desktop app, documents are written by the Rust
 * side into Documents\Quill\Inbox as one self-contained .html file each.
 * In a plain browser (vite dev), it falls back to localStorage so the editor
 * can still be tried.
 */
import { invoke } from "@tauri-apps/api/core";

export type DocSize = "small" | "body" | "large";
export type Spacing = "tight" | "comfortable" | "airy";

export const FONT_PX: Record<DocSize, number> = { small: 16.5, body: 19, large: 22 };
export const LINE_HEIGHT: Record<Spacing, number> = { tight: 1.45, comfortable: 1.75, airy: 2.05 };

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function newFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.html`
  );
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The stored file: readable in any browser, and loadable back into Quill. */
export function toFile(title: string, size: DocSize, spacing: Spacing, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="Quill">
<meta name="quill-size" content="${size}">
<meta name="quill-spacing" content="${spacing}">
<title>${esc(title)}</title>
<style>
body{max-width:62ch;margin:56px auto;padding:0 20px;font-family:Spectral,Georgia,serif;line-height:${LINE_HEIGHT[spacing]};color:#2B2D31;background:#FBFBF9;font-size:${FONT_PX[size]}px}
p{margin:0 0 .85em}s{opacity:.45}ul,ol{margin:0 0 .85em;padding-left:1.6em}li p{margin:0}ul{list-style:none}ul>li{position:relative}ul>li::before{content:"\\2022";position:absolute;left:-1.05em;color:#1F4FD1;font-weight:600}ol>li::marker{color:#1F4FD1}
[data-size=small]{font-size:.84em}[data-size=large]{font-size:1.32em}[data-size=title]{font-size:1.85em;line-height:1.25}
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

/** Saves the document and returns its full path on disk. */
export async function saveDocument(fileName: string, contents: string): Promise<string> {
  if (inTauri) {
    return invoke<string>("save_document", { fileName, contents });
  }
  try {
    localStorage.setItem("quill:" + fileName, contents);
  } catch {
    /* browser preview only; nothing else to do */
  }
  return fileName;
}

export async function libraryPath(): Promise<string> {
  return inTauri ? invoke<string>("library_path") : "browser preview (not saved to disk)";
}
