/**
 * Settings (Menu > Settings…, Ctrl+,): a panel on the right of the window, so
 * the page stays in view while you try skins on it.
 *
 *   Appearance  the eight skins. Clicking one restyles the real window; Cancel
 *               goes back, "Keep this skin" saves. Inside a skin: Day/Night,
 *               sound and paper texture.
 *   Writing     autocorrect, pages, typewriter scrolling, spell check. These
 *               apply straight away.
 *   Library     where the files live.
 *   Shortcuts   every key Quill listens for.
 */
import {
  SKINS,
  skinById,
  savedSkinId,
  savedPrefs,
  applySkin,
  keepSkin,
  fontStack,
  playSound,
  type Mode,
  type Skin,
  type SkinPrefs,
} from "./skins";
import { MOD } from "./ui";

interface Toggle {
  get: () => boolean;
  set: (on: boolean) => void;
}
export interface SettingsHooks {
  autocorrect: Toggle & { words: () => number };
  pages: Toggle;
  typewriter: Toggle;
  spellcheck: Toggle;
  libraryPath: () => string;
  showLibrary: () => void;
  /** The quick capture keys, or null outside the app. */
  captureKeys: (() => Promise<string>) | null;
  closed: () => void;
}

const TABS = ["Appearance", "Writing", "Library", "Shortcuts"] as const;
type Tab = (typeof TABS)[number];
let lastTab: Tab = "Appearance";
let root: HTMLElement | null = null;

export const settingsOpen = () => !!root;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

function switchButton(label: string, on: boolean, change: (on: boolean) => void, disabled = false) {
  const b = h("button", "set-switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-checked", String(on));
  b.disabled = disabled;
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    change(next);
  });
  return b;
}

function row(title: string, desc: string, control: HTMLElement) {
  const r = h("div", "set-row");
  const t = h("div", "set-row-t");
  t.append(h("b", "", title));
  const d = h("span", "set-d", desc);
  t.append(d);
  r.append(t, control);
  return { el: r, desc: d };
}

export function openSettings(hooks: SettingsHooks) {
  if (root) return;
  const startId = savedSkinId();
  let chosen = startId;
  // Choices made inside each skin while trying them, kept until Cancel.
  const drafts = new Map<string, SkinPrefs>();
  const prefsOf = (id: string) => drafts.get(id) ?? savedPrefs(id);
  const dirty = () => chosen !== startId || JSON.stringify(prefsOf(chosen)) !== JSON.stringify(savedPrefs(chosen));

  root = h("div", "settings");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "set-title");
  const card = h("div", "set-card");
  root.append(card);

  const head = h("header", "set-head");
  const title = h("h2", "", "Settings");
  title.id = "set-title";
  const x = h("button", "set-x");
  x.type = "button";
  x.title = "Close (Esc)";
  x.setAttribute("aria-label", "Close");
  x.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  head.append(title, x);

  const tabs = h("nav", "set-tabs");
  tabs.setAttribute("role", "tablist");
  const body = h("div", "set-body");
  const foot = h("footer", "set-foot");
  card.append(head, tabs, body, foot);

  /* ---------------------------------------------------------- Appearance */

  const appearance = h("div", "set-pane");
  const grid = h("div", "set-skins");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Skin");
  const tiles = new Map<string, HTMLButtonElement>();
  for (const s of SKINS) {
    const t = h("button", "set-tile");
    t.type = "button";
    t.setAttribute("role", "radio");
    t.dataset.id = s.id;
    const pg = h("span", "set-tile-pg");
    const aa = h("span", "set-aa", "Aa");
    aa.style.fontFamily = fontStack(s);
    aa.style.fontWeight = String(s.font.weight);
    aa.style.fontVariationSettings = `"SOFT" ${s.font.soft}`;
    const cur = h("i", "set-tile-caret");
    const dots = h("span", "set-dots");
    for (let i = 1; i < 5; i++) dots.append(h("i"));
    pg.append(aa, cur, dots);
    const nm = h("span", "set-tile-nm");
    nm.append(h("b", "", s.name));
    if (s.badge) nm.append(h("small", "", s.badge));
    t.append(pg, nm);
    t.addEventListener("click", () => choose(s.id));
    tiles.set(s.id, t);
    grid.append(t);
  }

  const about = h("div", "set-about");
  const aboutName = h("h3");
  const aboutTag = h("p", "set-tag");
  const aboutFacts = h("p", "set-facts");
  about.append(aboutName, aboutTag, aboutFacts);

  const within = h("div", "set-group");
  within.append(h("h4", "", "Within this skin"));
  const seg = h("div", "set-seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Day or Night");
  const modes: [Mode, string][] = [
    ["auto", "Windows"],
    ["day", "Day"],
    ["night", "Night"],
  ];
  const modeBtns = modes.map(([m, label]) => {
    const b = h("button", "", label);
    b.type = "button";
    b.addEventListener("click", () => update({ mode: m }));
    seg.append(b);
    return b;
  });
  const modeRow = row("Day or Night", "Follow Windows, or keep one", seg);
  const soundSw = switchButton("Sound", false, (on) => {
    update({ sound: on });
    const k = skinById(chosen).sound;
    if (on && k) playSound(k);
  });
  const soundRow = row("Sound", "", soundSw);
  const texSw = switchButton("Paper texture", true, (on) => update({ texture: on }));
  const texRow = row("Paper texture", "", texSw);
  within.append(modeRow.el, soundRow.el, texRow.el);
  appearance.append(grid, about, within);

  const SOUND_NAME: Record<string, string> = { nib: "A soft nib", page: "A page turning on each space", tick: "A light tick", clack: "Typewriter keys" };
  const TEXTURE_NAME: Record<string, string> = { flat: "Flat", grain: "Fine grain", laid: "Laid paper", bloom: "Soft bloom" };

  function paintTiles() {
    for (const s of SKINS) {
      const t = tiles.get(s.id)!;
      const p = prefsOf(s.id);
      const night = p.mode === "night" || (p.mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
      const v = night ? s.night : s.day;
      const pg = t.querySelector<HTMLElement>(".set-tile-pg")!;
      pg.style.background = v.paper;
      pg.style.color = v.ink;
      pg.style.setProperty("--tile-acc", v.accent);
      pg.querySelectorAll<HTMLElement>(".set-dots i").forEach((d, i) => (d.style.background = v.shelfInks[i + 1]));
      t.setAttribute("aria-checked", String(s.id === chosen));
      t.tabIndex = s.id === chosen ? 0 : -1;
    }
  }

  function paintWithin() {
    const s: Skin = skinById(chosen);
    const p = prefsOf(chosen);
    aboutName.textContent = s.name;
    aboutTag.textContent = s.tagline;
    const tex = s.day.texture;
    aboutFacts.textContent = `${s.font.label} · ${s.cursor.label.split(":")[0]} cursor · ${TEXTURE_NAME[tex]} · ${s.toolbarFinish}`;
    modeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(modes[i][0] === p.mode)));
    soundSw.disabled = !s.sound;
    soundSw.setAttribute("aria-checked", String(!!s.sound && p.sound));
    soundRow.desc.textContent = s.sound ? `${SOUND_NAME[s.sound]}, off unless you turn it on` : "This skin is silent";
    texSw.disabled = tex === "flat";
    texSw.setAttribute("aria-checked", String(tex !== "flat" && p.texture));
    texRow.desc.textContent = tex === "flat" ? "This skin's paper is flat" : "Turn off for a perfectly flat page";
  }

  function choose(id: string) {
    chosen = id;
    applySkin(id, prefsOf(id));
    paintTiles();
    paintWithin();
    paintFoot();
  }
  function update(patch: Partial<SkinPrefs>) {
    drafts.set(chosen, { ...prefsOf(chosen), ...patch });
    applySkin(chosen, prefsOf(chosen));
    paintTiles();
    paintWithin();
    paintFoot();
  }

  // Arrow keys move between tiles, like any group of choices.
  grid.addEventListener("keydown", (e) => {
    const i = SKINS.findIndex((s) => s.id === chosen);
    const step = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = SKINS[(i + step + SKINS.length) % SKINS.length].id;
    choose(next);
    tiles.get(next)!.focus();
  });

  /* ---------------------------------------------------------- Writing */

  const writing = h("div", "set-pane");
  const words = hooks.autocorrect.words();
  writing.append(
    row(
      "Autocorrect",
      words ? `Fixes slips as you type. Knows ${words.toLocaleString()} words.` : "Fixes slips as you type.",
      switchButton("Autocorrect", hooks.autocorrect.get(), hooks.autocorrect.set),
    ).el,
    row("Pages", "Show Letter sheets as you write, the way they'll print", switchButton("Pages", hooks.pages.get(), hooks.pages.set)).el,
    row(
      "Typewriter scrolling",
      "Keep the line you're writing at the same height in the window",
      switchButton("Typewriter scrolling", hooks.typewriter.get(), hooks.typewriter.set),
    ).el,
    row("Spell check", "Underline words Windows doesn't know", switchButton("Spell check", hooks.spellcheck.get(), hooks.spellcheck.set)).el,
  );

  /* ---------------------------------------------------------- Library */

  const lib = h("div", "set-pane");
  const where = h("div", "set-group");
  where.append(h("h4", "", "Where your writing lives"));
  const path = h("p", "set-path", hooks.libraryPath() || "…");
  const show = h("button", "set-btn", "Show in File Explorer");
  show.type = "button";
  show.addEventListener("click", hooks.showLibrary);
  where.append(path, show);
  const notes = h("div", "set-group");
  notes.append(
    h("h4", "", "Good to know"),
    h("p", "set-note", "Every page is an ordinary file in this folder, so you can back it up, sync it or open it anywhere."),
    h("p", "set-note", "Pages and folders you delete wait in Quill's Trash for 30 days before they're removed for good."),
  );
  lib.append(where, notes);

  /* ---------------------------------------------------------- Shortcuts */

  const keys = h("div", "set-pane");
  const table = h("dl", "set-keys");
  const shortcuts: [string, string][] = [
    ["New page", `${MOD} N`],
    ["Library", `${MOD} L`],
    ["Print", `${MOD} P`],
    ["Save now (Quill also saves as you go)", `${MOD} S`],
    ["Settings", `${MOD} ,`],
    ["Quick capture, from anywhere", "Ctrl Alt Q"],
    ["Bold", `${MOD} B`],
    ["Italic", `${MOD} I`],
    ["Strike-through", `${MOD} Shift X`],
    ["Bullet list", `${MOD} Shift 8`],
    ["Numbered list", `${MOD} Shift 7`],
    ["Undo", `${MOD} Z`],
    ["Redo", `${MOD} Y`],
    ["Show the top shelf", "Alt"],
    ["Full screen", "F11"],
  ];
  const captureKbd: HTMLElement[] = [];
  for (const [what, k] of shortcuts) {
    const dd = h("dd");
    dd.append(...k.split(" ").map((p) => h("kbd", "", p)));
    if (what.startsWith("Quick capture")) captureKbd.push(dd);
    table.append(h("dt", "", what), dd);
  }
  void hooks.captureKeys?.().then((k) => captureKbd.forEach((dd) => dd.replaceChildren(...k.split(" ").map((p) => h("kbd", "", p)))));
  keys.append(table);

  /* ---------------------------------------------------------- tabs and footer */

  const panes: Record<Tab, HTMLElement> = { Appearance: appearance, Writing: writing, Library: lib, Shortcuts: keys };
  const tabBtns = TABS.map((name) => {
    const b = h("button", "", name);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => show_(name));
    tabs.append(b);
    return b;
  });
  function show_(tab: Tab) {
    lastTab = tab;
    tabBtns.forEach((b, i) => {
      b.setAttribute("aria-selected", String(TABS[i] === tab));
      b.tabIndex = TABS[i] === tab ? 0 : -1;
    });
    body.replaceChildren(panes[tab]);
    body.scrollTop = 0;
    paintFoot();
  }
  tabs.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const i = (TABS.indexOf(lastTab) + step + TABS.length) % TABS.length;
    show_(TABS[i]);
    tabBtns[i].focus();
  });

  const cancel = h("button", "set-btn", "Cancel");
  cancel.type = "button";
  const keep = h("button", "set-btn go", "Keep this skin");
  keep.type = "button";
  const done = h("button", "set-btn go", "Done");
  done.type = "button";
  function paintFoot() {
    foot.replaceChildren(...(dirty() ? [cancel, keep] : [done]));
  }
  cancel.addEventListener("click", () => close(false));
  keep.addEventListener("click", () => close(true));
  done.addEventListener("click", () => close(false));
  x.addEventListener("click", () => close(false));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
    }
  };
  addEventListener("keydown", onKey, true);

  function close(save: boolean) {
    if (!root) return;
    if (save) keepSkin(chosen, prefsOf(chosen));
    else if (dirty()) applySkin(startId, savedPrefs(startId)); // back to what was kept
    removeEventListener("keydown", onKey, true);
    root.classList.remove("on");
    const r = root;
    root = null;
    setTimeout(() => r.remove(), 200);
    hooks.closed();
  }

  document.body.append(root);
  paintTiles();
  paintWithin();
  show_(lastTab);
  requestAnimationFrame(() => {
    root?.classList.add("on");
    (lastTab === "Appearance" ? tiles.get(chosen)! : tabBtns[TABS.indexOf(lastTab)]).focus();
  });
}
