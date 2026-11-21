/**
 * The few things Quill asks of the operating system: window controls, full
 * screen, and showing a file in File Explorer. In a plain browser (the dev
 * preview) these quietly do nothing.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const win = () => getCurrentWindow();

export async function minimize() {
  if (inTauri) await win().minimize();
}

export async function toggleMaximize() {
  if (inTauri) await win().toggleMaximize();
}

export async function isMaximized(): Promise<boolean> {
  return inTauri ? win().isMaximized() : false;
}

export async function close() {
  if (inTauri) await win().close(); // runs the close handler below first
}

export async function toggleFullscreen(): Promise<boolean> {
  if (inTauri) {
    const on = !(await win().isFullscreen());
    await win().setFullscreen(on);
    return on;
  }
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen().catch(() => undefined);
  return !!document.fullscreenElement;
}

/** Run `beforeClose` (to save) before the window closes, however it is closed. */
export function onClose(beforeClose: () => Promise<void>) {
  if (inTauri) void win().onCloseRequested(async () => beforeClose());
  else addEventListener("beforeunload", () => void beforeClose());
}

/** A message from the capture window, e.g. "library://changed". */
export function onAppEvent(name: string, fn: () => void) {
  if (inTauri) void listen(name, fn);
}

export async function openCapture() {
  if (inTauri) await invoke("open_capture");
}

export function onResized(fn: () => void) {
  if (inTauri) void win().onResized(fn);
  addEventListener("resize", fn);
}

export async function showInExplorer(path: string) {
  if (inTauri) await revealItemInDir(path);
}
