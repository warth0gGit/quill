/**
 * Skins: curated sets of typeface, paper, inks, cursor, texture, rhythm,
 * toolbar finish and (optional) key sound. A skin is applied whole; inside a
 * skin only Day/Night, sound and paper texture can be changed.
 *
 * The data comes straight from the design (skins.json). Everything else in
 * Quill reads the skin through CSS variables on <html> and a few data
 * attributes on <body>:
 *   --paper --desk --ink --accent, the five inks --midnight --cobalt --azure
 *   --signal (Shelf roles, kept under their original names so documents keep
 *   working), --font --size --fw --soft --lh --col --mx, --paper-tex --room-tex.
 *   body[data-cursor] [data-finish] [data-para] [data-skin] [data-night]
 */
import DATA from "./skins.json";

export type Mode = "auto" | "day" | "night";
export type Texture = "flat" | "grain" | "laid" | "bloom";
export type Sound = "nib" | "page" | "tick" | "clack";
interface Variant {
  ground: string;
  paper: string;
  ink: string;
  accent: string;
  shelfInks: string[];
  texture: Texture;
}
export interface Skin {
  id: string;
  name: string;
  tagline: string;
  badge: string | null;
  default: boolean;
  font: { family: string; label: string; sizePx: number; weight: number; soft: number };
  rhythm: { lineHeight: number; paragraph: "gap" | "indent"; pageWidthPx: number };
  cursor: { id: string; label: string };
  sound: Sound | null;
  toolbarFinish: string;
  day: Variant;
  night: Variant;
}
export interface SkinPrefs {
  mode: Mode;
  sound: boolean;
  texture: boolean;
}

export const SKINS = DATA as Skin[];
export const DEFAULT_SKIN = SKINS.find((s) => s.default)!;
export const skinById = (id: string | null) => SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;

const STACKS: Record<string, string> = {
  Spectral: '"Spectral", Georgia, serif',
  "Cormorant Garamond": '"Cormorant Garamond", Georgia, serif',
  "Gowun Batang": '"Gowun Batang", Georgia, serif',
  "EB Garamond": '"EB Garamond", Georgia, serif',
  Newsreader: '"Newsreader", Georgia, serif',
  "Source Serif 4": '"Source Serif 4", Georgia, serif',
  "DM Mono": '"DM Mono", Consolas, monospace',
  Fraunces: '"Fraunces Variable", Georgia, serif',
};
export const fontStack = (s: Skin) => STACKS[s.font.family] ?? `"${s.font.family}", Georgia, serif`;

/** Labels for the five inks. Cobalt Ink keeps the names Jonny chose; other skins use roles. */
export function inkNames(s: Skin): string[] {
  return s.id === "cobalt"
    ? ["Graphite", "Midnight", "Cobalt", "Azure", "Signal red"]
    : ["Ink", "Deep", "Main", "Cool", "Warm"];
}

/* ------------------------------------------------------------ textures */

const noise = (rgb: string, a: number) =>
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb}  0 0 0 0 ${rgb}  0 0 0 0 ${rgb}  0 0 0 ${a} 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;
const GRAIN = { day: noise("0", 0.07), night: noise("1", 0.035) };
const LAID = {
  day: "repeating-linear-gradient(0deg, rgba(120,90,50,.045) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(120,90,50,.05) 0 1px, transparent 1px 90px)",
  night: "repeating-linear-gradient(0deg, rgba(255,230,200,.03) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(255,230,200,.035) 0 1px, transparent 1px 90px)",
};
const BLOOM: Record<string, { day: string; night: string }> = {
  swim: { day: "rgba(22,119,201,.06)", night: "rgba(63,198,240,.08)" },
  cloud: { day: "rgba(226,143,181,.10)", night: "rgba(226,143,181,.07)" },
};
const bloom = (c: string) => `radial-gradient(120% 70% at 85% 0%, ${c}, transparent 60%)`;

function textures(s: Skin, night: boolean, on: boolean): { paper: string; room: string } {
  const t = (night ? s.night : s.day).texture;
  if (!on || t === "flat") return { paper: "none", room: "none" };
  const k = night ? "night" : "day";
  if (t === "grain") return { paper: GRAIN[k], room: "none" };
  if (t === "laid") return { paper: LAID[k], room: "none" };
  const b = BLOOM[s.id] ?? { day: "rgba(0,0,0,0)", night: "rgba(0,0,0,0)" };
  return { paper: "none", room: bloom(b[k]) };
}

/* ------------------------------------------------------------ preferences */

const KEY = "quill:pref:skin";
const BOOT = "quill:skin:boot";
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* a convenience: the skin still applies for this session */
  }
};

export function savedSkinId(): string {
  return skinById(read(KEY)).id;
}
export function savedPrefs(id: string): SkinPrefs {
  const base: SkinPrefs = { mode: "auto", sound: false, texture: true };
  try {
    return { ...base, ...JSON.parse(read(`${KEY}:${id}`) ?? "{}") };
  } catch {
    return base;
  }
}

/* ------------------------------------------------------------ applying */

const dark = matchMedia("(prefers-color-scheme: dark)");
let current: { skin: Skin; prefs: SkinPrefs; night: boolean } = { skin: DEFAULT_SKIN, prefs: savedPrefs(DEFAULT_SKIN.id), night: false };
const listeners: ((s: Skin) => void)[] = [];
export const onSkinChange = (fn: (s: Skin) => void) => listeners.push(fn);
export const currentSkin = () => current.skin;
export const currentPrefs = () => current.prefs;
export const isNight = () => current.night;

const printStyle = document.createElement("style");
printStyle.id = "skin-print";

/** Restyles the window. Doesn't save: use keepSkin for that. */
export function applySkin(id: string, prefs: SkinPrefs = savedPrefs(id)) {
  const s = skinById(id);
  const night = prefs.mode === "night" || (prefs.mode === "auto" && dark.matches);
  const v = night ? s.night : s.day;
  current = { skin: s, prefs, night };
  const r = document.documentElement.style;
  const set = (k: string, val: string) => r.setProperty(k, val);
  set("--paper", v.paper);
  set("--desk", v.ground);
  set("--ink", v.ink);
  set("--accent", v.accent);
  ["--graphite", "--midnight", "--cobalt", "--azure", "--signal"].forEach((k, i) => set(k, v.shelfInks[i]));
  set("--font", fontStack(s));
  set("--size", `${s.font.sizePx}px`);
  set("--fw", String(s.font.weight));
  set("--soft", String(s.font.soft));
  set("--lh", String(s.rhythm.lineHeight));
  set("--col", `${s.rhythm.pageWidthPx}px`);
  set("--mx", `${pageMarginX(s)}px`);
  const tex = textures(s, night, prefs.texture);
  set("--paper-tex", tex.paper);
  set("--room-tex", tex.room);
  r.colorScheme = night ? "dark" : "light";
  const b = document.body?.dataset;
  if (b) {
    b.skin = s.id;
    b.cursor = s.cursor.id;
    b.finish = s.toolbarFinish.toLowerCase().includes("glass") ? "glass" : s.toolbarFinish.toLowerCase().includes("hair") ? "hairline" : "solid";
    b.para = s.rhythm.paragraph;
    b.night = String(night);
  }
  // Print and PDF: plain white paper, the skin's Day inks, the skin's margins.
  const d = s.day;
  printStyle.textContent = `@page { margin: 1in ${(pageMarginX(s) / 96).toFixed(4)}in; }
@media print { :root { color-scheme: light; --paper: #fff; --ink: ${d.ink}; --accent: ${d.accent}; --graphite: ${d.shelfInks[0]}; --midnight: ${d.shelfInks[1]}; --cobalt: ${d.shelfInks[2]}; --azure: ${d.shelfInks[3]}; --signal: ${d.shelfInks[4]}; --paper-tex: none; --room-tex: none; } }`;
  if (!printStyle.isConnected) document.head.appendChild(printStyle);
  // The splash on the next start shows this paper straight away (public/boot.js).
  write(
    BOOT,
    JSON.stringify({ mode: prefs.mode, day: [s.day.paper, s.day.ink, s.day.ground], night: [s.night.paper, s.night.ink, s.night.ground] }),
  );
  for (const fn of listeners) fn(s);
  // A face is read from disk the first time it's used; lay out again once it's in.
  void document.fonts?.load(`${s.font.weight} ${s.font.sizePx}px ${fontStack(s)}`).then(() => {
    if (current.skin === s) for (const fn of listeners) fn(s);
  });
}

/** Saves the skin (and its Day/Night, sound and texture choices) and applies it. */
export function keepSkin(id: string, prefs: SkinPrefs) {
  write(KEY, id);
  write(`${KEY}:${id}`, JSON.stringify(prefs));
  applySkin(id, prefs);
}

/** Applies the saved skin, and follows Windows' light/dark and changes from other windows. */
export function startSkins() {
  const id = savedSkinId();
  applySkin(id, savedPrefs(id));
  dark.addEventListener("change", () => current.prefs.mode === "auto" && applySkin(current.skin.id, current.prefs));
  // The quick capture window follows the main window's choice.
  addEventListener("storage", (e) => {
    if (e.key === KEY || e.key?.startsWith(KEY + ":")) {
      const id = savedSkinId();
      applySkin(id, savedPrefs(id));
    }
  });
}

/** Side margins on a sheet: 1 inch, or wider for a skin with a narrow column. */
export function pageMarginX(s: Skin = current.skin): number {
  return s.rhythm.pageWidthPx < 600 ? Math.round((816 - s.rhythm.pageWidthPx) / 2) : 96;
}

/* ------------------------------------------------------------ the cursor */

/** Where the cursor goes for a character box. The block (Clack) covers the next letter. */
export function caretBox(c: { left: number; top: number; bottom: number }) {
  const lineH = c.bottom - c.top;
  if (current.skin.cursor.id === "block") {
    const h = lineH * 0.86;
    return { x: c.left + 0.5, y: c.top + (lineH - h) / 2, w: h * 0.55, h };
  }
  const h = lineH * 0.75;
  return { x: c.left + 1.5, y: c.top + (lineH - h) / 2, w: 0, h };
}

/** Frost: a little spark on every key. */
export function flare(caret: HTMLElement) {
  if (current.skin.cursor.id !== "frost") return;
  caret.classList.remove("flare");
  void caret.offsetWidth; // restart the animation
  caret.classList.add("flare");
}

/* ------------------------------------------------------------ sound */
// Synthesised, so nothing to ship: a burst of noise with a quick decay through
// a band-pass filter. Off unless switched on in Settings.

let audio: AudioContext | null = null;

export function keySound(e: KeyboardEvent) {
  const kind = current.skin.sound;
  if (!kind || !current.prefs.sound || e.ctrlKey || e.metaKey || e.altKey) return;
  const printable = e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Tab";
  if (!printable) return;
  if (kind === "page" && e.key !== " " && e.key !== "Enter") return; // a page turns on space and new lines only
  playSound(kind);
}

export function playSound(kind: Sound) {
  try {
    audio ??= new AudioContext();
    const len = kind === "clack" ? 0.05 : kind === "page" ? 0.03 : 0.035;
    const power = kind === "clack" ? 6 : 3;
    const n = Math.floor(audio.sampleRate * len);
    const burst = audio.createBuffer(1, n, audio.sampleRate);
    const ch = burst.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, power);
    const src = audio.createBufferSource();
    src.buffer = burst;
    const f = audio.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = { clack: 1800 + Math.random() * 600, tick: 5200, nib: 3600, page: 900 }[kind];
    f.Q.value = kind === "tick" ? 6 : 1.2;
    const g = audio.createGain();
    g.gain.value = { clack: 0.55, tick: 0.25, nib: 0.12, page: 0.12 }[kind];
    src.connect(f).connect(g).connect(audio.destination);
    src.start();
  } catch {
    /* no audio device: stay silent */
  }
}
