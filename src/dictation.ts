/**
 * Dictation: speak, and Quill writes it at the cursor.
 *
 * Ctrl+Shift+D (or the Dictate button) starts and stops it; Esc also stops.
 * The listening and the speech recognition happen on this PC (see
 * src-tauri/src/dictation.rs); this side shows it and puts the words in.
 *
 * While Quill listens, the Glow cursor stops its slow breath and swells with
 * your voice. Each phrase arrives faint and settles into ink a moment later.
 * Dictated words take the Shelf's style for the next words, exactly like
 * typing, and one Ctrl+Z takes back one spoken phrase.
 *
 * A few things you can say: "new paragraph", "new line", "scratch that"
 * (removes the last phrase) and "stop listening".
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./platform";

export const DICTATE_KEYS = "Ctrl+Shift+D";

export const MIC_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="5.6" y="1.6" width="4.8" height="8" rx="2.4"/><path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2"/></svg>';

/* ------------------------------------------------------------ words arriving faint */

const ghostKey = new PluginKey<DecorationSet>("quillDictationGhost");
type GhostMeta = { add?: { from: number; to: number; id: number }; remove?: number };

/** Paints newly dictated words faint; they settle into ink by CSS animation. */
export const DictationGhost = Extension.create({
  name: "dictationGhost",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: ghostKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            set = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(ghostKey) as GhostMeta | undefined;
            if (meta?.add && meta.add.to > meta.add.from) {
              const { from, to, id } = meta.add;
              set = set.add(tr.doc, [Decoration.inline(from, to, { class: "dict-new" }, { id })]);
            }
            if (meta?.remove !== undefined) set = set.remove(set.find(undefined, undefined, (s) => s.id === meta.remove));
            return set;
          },
        },
        props: { decorations: (state) => ghostKey.getState(state) },
      }),
    ];
  },
});

/* ------------------------------------------------------------ spoken commands */

type Piece = { text: string } | { command: "paragraph" | "line" | "scratch" | "stop" };

const COMMANDS: [RegExp, "paragraph" | "line" | "scratch" | "stop"][] = [
  [/^(new|next) paragraph$/, "paragraph"],
  [/^(new|next) line$/, "line"],
  [/^(scratch|delete|undo) that$/, "scratch"],
  [/^stop (listening|dictation|dictating)$/, "stop"],
];
const COMMAND_RE = /\b(?:(?:new|next) paragraph|(?:new|next) line|(?:scratch|delete|undo) that|stop (?:listening|dictation|dictating))\b[.,!?]*/gi;

/** Splits what Whisper heard into words to write and commands to follow. */
export function parseSpeech(heard: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  const pushText = (t: string) => {
    // Punctuation Whisper hung on a command belongs to neither side.
    const text = t.replace(/^[\s.,;:!?]+(?=\S)/, "").replace(/[\s,;:]+$/, "").trim();
    if (text && /[\p{L}\p{N}]/u.test(text)) out.push({ text });
  };
  for (const m of heard.matchAll(COMMAND_RE)) {
    pushText(heard.slice(last, m.index));
    const phrase = m[0].toLowerCase().replace(/[.,!?]+$/, "").trim();
    const found = COMMANDS.find(([re]) => re.test(phrase));
    if (found) out.push({ command: found[1] });
    last = m.index! + m[0].length;
  }
  pushText(heard.slice(last));
  return out;
}

/* ------------------------------------------------------------ the controller */

type Event =
  | { kind: "preparing" | "listening" | "hearing" | "silent" | "downloaded" }
  | { kind: "level"; level: number }
  | { kind: "text"; text: string }
  | { kind: "stopped"; error: string | null }
  | { kind: "download"; done: number; total: number }
  | { kind: "downloadFailed"; error: string };

export interface DictationHost {
  editor: Editor;
  caret: HTMLElement;
  /** Shows a short note at the edge of the window. */
  note: (text: string, ms?: number) => void;
  /** Called when listening starts or stops. */
  changed?: (on: boolean) => void;
}

export function setupDictation(host: DictationHost) {
  const { editor, caret, note } = host;
  let on = false; // listening, or about to
  let stopping = false;
  let sinceCapital = true; // the next phrase starts a paragraph
  let nextId = 1;
  // Where each dictated phrase sits, newest last, for "scratch that".
  let said: { from: number; to: number }[] = [];
  const label = inTauri ? getCurrentWindow().label : "";

  editor.on("transaction", ({ transaction: tr }) => {
    if (!tr.docChanged || !said.length) return;
    said = said.map((r) => ({ from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) })).filter((r) => r.to > r.from);
  });

  function show(listening: boolean) {
    caret.classList.toggle("listening", listening);
    if (!listening) {
      caret.classList.remove("hearing");
      caret.style.removeProperty("--lvl");
    }
    host.changed?.(listening);
  }

  /* ---------- putting words in */

  function write(text: string) {
    const { state } = editor;
    const { from, to, $from } = state.selection;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "￼");
    const $to = state.doc.resolve(to);
    const after = $to.parent.textBetween($to.parentOffset, Math.min($to.parent.content.size, $to.parentOffset + 1), undefined, "\ufffc");
    if (sinceCapital || before === "") text = text.charAt(0).toUpperCase() + text.slice(1);
    // "\ufffc" stands for a line break or picture: no space after those.
    const lead = before && before !== "\ufffc" && !/\s/.test(before) && !/^[.,;:!?)\]]/.test(text) ? " " : "";
    const trail = after && !/[\s.,;:!?)\]]/.test(after) ? " " : "";
    const tr = closeHistory(state.tr).insertText(lead + text + trail);
    const id = nextId++;
    const start = from + lead.length;
    const end = start + text.length;
    tr.setMeta(ghostKey, { add: { from: start, to: end, id } } satisfies GhostMeta);
    tr.scrollIntoView();
    editor.view.dispatch(tr);
    said.push({ from, to: end + trail.length });
    if (said.length > 50) said.shift();
    sinceCapital = false;
    setTimeout(() => editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { remove: id }).setMeta("addToHistory", false)), 1000);
  }

  function follow(command: "paragraph" | "line" | "scratch" | "stop") {
    if (command === "stop") return void stop();
    if (command === "scratch") {
      const last = said.pop();
      if (!last) return;
      editor.view.dispatch(closeHistory(editor.state.tr).delete(last.from, last.to).scrollIntoView());
      return;
    }
    editor.view.dispatch(closeHistory(editor.state.tr)); // its own step in Undo
    if (command === "paragraph") {
      editor.commands.splitBlock();
      sinceCapital = true;
    } else {
      editor.commands.setHardBreak();
    }
  }

  function heard(text: string) {
    for (const piece of parseSpeech(text)) {
      if ("command" in piece) follow(piece.command);
      else write(piece.text);
    }
  }

  /* ---------- the model download, once */

  let offer: HTMLElement | null = null;
  function closeOffer() {
    offer?.remove();
    offer = null;
  }

  function offerDownload(mb: number) {
    closeOffer();
    offer = document.createElement("div");
    offer.className = "dict-offer";
    offer.setAttribute("role", "dialog");
    offer.setAttribute("aria-label", "Set up dictation");
    offer.innerHTML =
      `<p><b>Dictation</b> writes what you say, entirely on this PC. It needs a one-time download of its speech model (${mb} MB). After that it works offline.</p>` +
      `<div class="row"><button type="button" class="later">Not now</button><button type="button" class="go">Download</button></div>`;
    for (const b of offer.querySelectorAll("button")) b.addEventListener("mousedown", (e) => e.preventDefault());
    offer.querySelector(".later")!.addEventListener("click", () => {
      closeOffer();
      editor.commands.focus();
    });
    offer.querySelector(".go")!.addEventListener("click", () => {
      closeOffer();
      note("Downloading the speech model…", 60_000);
      void invoke("dictation_download");
      editor.commands.focus();
    });
    document.body.appendChild(offer);
    (offer.querySelector(".go") as HTMLButtonElement).focus();
  }

  /* ---------- start and stop */

  async function start() {
    if (!inTauri) {
      note("Dictation works in the Quill app");
      return;
    }
    if (on) return;
    on = true;
    stopping = false;
    sinceCapital = editor.state.selection.$from.parentOffset === 0;
    try {
      await invoke("dictation_start");
      show(true);
    } catch (e) {
      on = false;
      if (String(e) === "model-missing") {
        const [, mb] = await invoke<[boolean, number]>("dictation_ready");
        offerDownload(mb);
      } else {
        note(String(e), 6000);
      }
    }
  }

  async function stop() {
    if (!on || stopping) return;
    stopping = true;
    if (inTauri) await invoke("dictation_stop");
  }

  const toggle = () => (on ? stop() : start());

  if (inTauri) {
    void listen<{ window: string } & Event>("dictation://event", ({ payload: ev }) => {
      if (ev.window !== label) return;
      switch (ev.kind) {
        case "preparing":
          note("Getting the speech model ready…", 15_000);
          break;
        case "listening":
          note(`Listening · ${DICTATE_KEYS} to stop`, 2600);
          break;
        case "level":
          caret.style.setProperty("--lvl", ev.level.toFixed(2));
          break;
        case "hearing":
          caret.classList.add("hearing");
          break;
        case "text":
          caret.classList.remove("hearing");
          heard(ev.text);
          break;
        case "silent":
          note("Quill hears only silence. Check the microphone, and Windows Settings > Privacy > Microphone.", 8000);
          break;
        case "stopped":
          on = false;
          stopping = false;
          show(false);
          note(ev.error ?? "Stopped listening", ev.error ? 7000 : 1400);
          break;
        case "download":
          note(ev.total ? `Downloading the speech model · ${Math.floor((ev.done / ev.total) * 100)}%` : "Downloading the speech model…", 60_000);
          break;
        case "downloaded":
          note("Speech model ready", 1400);
          void start();
          break;
        case "downloadFailed":
          note(ev.error, 7000);
          break;
      }
    });
  }

  // Ctrl+Shift+D anywhere in the window; Esc stops listening before it does anything else.
  addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyD") {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      } else if (e.key === "Escape" && offer) {
        e.preventDefault();
        e.stopPropagation();
        closeOffer();
        editor.commands.focus();
      } else if (e.key === "Escape" && on) {
        e.preventDefault();
        e.stopPropagation();
        void stop();
      }
    },
    { capture: true },
  );

  return { start, stop, toggle, isOn: () => on };
}
