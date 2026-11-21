/**
 * The thinking half of autocorrect, kept free of the editor so it can be
 * tested on its own. Given the text before a word, the word, and the key
 * that ended it, it says what the word should become (or null to leave it).
 *
 * Three kinds of fix, in this order:
 *  1. "i" on its own, and i'm / i've / i'll / i'd, become capital I.
 *  2. Hand-picked fixes: dropped apostrophes (dont -> don't) and the
 *     misspellings people make most (teh, recieve, becuase...).
 *  3. A careful guess for other obvious slips: a word Quill doesn't know
 *     that is one swapped, missing, extra or neighbouring key away from a
 *     common word, when there is one clear winner.
 * Then the first word of a sentence gets its capital letter.
 */
import { FIXES, ABBREVIATIONS } from "./autocorrect-list";

/** Common words in order, most used first (filled in once the list loads). */
let rank: Map<string, number> | null = null;

export function loadWords(text: string) {
  const m = new Map<string, number>();
  let i = 0;
  for (const line of text.split("\n")) {
    // Windows checkouts can add "\r" to each line: strip it.
    const w = line.trim();
    if (w) m.set(w, i++);
  }
  // Hand-picked typos are never "real words", even if people type them a lot.
  for (const k of FIXES.keys()) m.delete(k);
  rank = m;
}

export const wordsLoaded = () => rank !== null;
export const wordCount = () => rank?.size ?? 0;

/** Words the writer has told Quill to leave alone (by undoing a fix). */
const leaveAlone = new Set<string>();
export function setLeaveAlone(words: Iterable<string>) {
  leaveAlone.clear();
  for (const w of words) leaveAlone.add(w.toLowerCase());
}

/** What comes just before a word that we're willing to touch. */
const OPENERS = /[\s"“‘'(\[{—–]/u;
const CLOSERS = /["”’')\]}]+$/u;

/** Is a word, preceded by `before`, the first word of a sentence? */
export function startsSentence(before: string): boolean {
  let s = before.replace(/["“‘'(\[{]+$/u, "").replace(/[ \t ]+$/u, "");
  if (s === "" || s.endsWith("\n")) return true;
  if (s.length === before.length) return false; // no space between: mid-word
  s = s.replace(CLOSERS, "");
  const last = s.slice(-1);
  if (last === "!" || last === "?") return true;
  if (last !== ".") return false;
  if (s.endsWith("..") || s.endsWith("…")) return false; // trailing off…
  const token = /([\p{L}.]+)\.$/u.exec(s)?.[1] ?? "";
  if (!token) return true; // "3." or similar
  const t = token.toLowerCase();
  if (ABBREVIATIONS.has(t)) return false;
  if (token.length === 1) return false; // an initial: "J. Smith"
  if (token.includes(".")) return false; // e.g. / i.e. / U.S.
  return true;
}

type Casing = "lower" | "title" | "upper" | "mixed";
function casingOf(w: string): Casing {
  if (w === w.toLowerCase()) return "lower";
  if (w.length > 1 && w === w.toUpperCase()) return "upper";
  if (w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) return "title";
  return "mixed";
}

function applyCasing(fixed: string, c: Casing): string {
  if (c === "upper") return fixed.toUpperCase();
  if (c === "title") return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/* ------------------------------------------------------------ the careful guess */

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR = new Map<string, string>();
for (let r = 0; r < ROWS.length; r++)
  for (let c = 0; c < ROWS[r].length; c++) {
    let n = "";
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, -1]]) {
      const ch = ROWS[r + dr]?.[c + dc];
      if (ch) n += ch;
    }
    NEAR.set(ROWS[r][c], n);
  }
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Only guess towards words in the most common this-many. */
const COMMON = 30000;
/** Known words rarer than this can still be slips of a very common word ("realy"). */
const RARE = 60000;
const VERY_COMMON = 12000;

function guess(w: string): string | null {
  if (!rank || w.length < 3 || !/^[a-z]+$/.test(w)) return null;
  const own = rank.get(w);
  if (own !== undefined && own < RARE) return null; // a real word
  const known = own !== undefined;
  const limit = known ? VERY_COMMON : COMMON;
  const short = w.length === 3; // three letters: only swapped pairs (nwe -> new)
  const found = new Map<string, number>();
  const consider = (c: string, firstMayChange = false) => {
    // People rarely miss the first key of a word, so a guess keeps it.
    if (!firstMayChange && c[0] !== w[0]) return;
    // Plurals and endings are the writer's choice, not a typo.
    if (c + "s" === w || w + "s" === c || c + "d" === w || w + "d" === c) return;
    const r = rank!.get(c);
    if (r !== undefined && r < limit) found.set(c, r);
  };
  for (let i = 0; i < w.length; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i + 1);
    if (i < w.length - 1) consider(a + w[i + 1] + w[i] + w.slice(i + 2), i === 0); // swapped
    if (short) continue;
    // An extra key: only a doubled letter if the word is real but rare, and
    // never just the last letter unless it was doubled ("pleasee").
    const doubled = w[i] === w[i - 1] || w[i] === w[i + 1];
    if (doubled || (!known && i < w.length - 1)) consider(a + b);
    if (!known) for (const ch of NEAR.get(w[i]) ?? "") consider(a + ch + b); // a neighbouring key
  }
  if (!short)
    for (let i = 1; i <= w.length; i++)
      for (const ch of LETTERS) consider(w.slice(0, i) + ch + w.slice(i)); // a missed key
  // A rare real word only gives way to one far more common (20 times or more).
  if (known) for (const [c, r] of found) if (own! < r * 20) found.delete(c);
  if (found.size === 0) return known ? null : twoSlips(w);
  const best = [...found].sort((x, y) => x[1] - y[1]);
  // One clear winner: at least three times as common as the runner-up.
  if (best.length > 1 && best[1][1] < best[0][1] * 3 + 50) return null;
  return best[0][0];
}

/** Common words grouped by first letter, for the two-slip search. */
let byFirst: Map<string, string[]> | null = null;
const TWO_SLIPS_TOP = 15000;

/** Edit distance where a swapped pair counts as one slip; gives up past `max`. */
function slips(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Two slips in a longer word ("definatly", "acommodate"): only towards common words. */
function twoSlips(w: string): string | null {
  if (w.length < 6 || !rank) return null;
  if (!byFirst) {
    byFirst = new Map();
    for (const [word, r] of rank) {
      if (r >= TWO_SLIPS_TOP || word.length < 5) continue;
      const list = byFirst.get(word[0]) ?? [];
      list.push(word);
      byFirst.set(word[0], list);
    }
  }
  const found: [string, number][] = [];
  for (const c of byFirst.get(w[0]) ?? []) {
    if (slips(w, c, 2) <= 2) found.push([c, rank.get(c)!]);
  }
  if (found.length === 0) return null;
  found.sort((x, y) => x[1] - y[1]);
  if (found.length > 1 && found[1][1] < found[0][1] * 5 + 100) return null;
  return found[0][0];
}

/* ------------------------------------------------------------ the whole decision */

export interface Correction {
  text: string;
  /** true when only a capital letter changed */
  capitalOnly: boolean;
}

/**
 * @param before   the paragraph's text before the word ("\n" for line breaks)
 * @param word     the word just finished
 * @param ender    the key that finished it ("" for Enter)
 */
export function correct(before: string, word: string, ender: string): Correction | null {
  if (!word || /\d/.test(word)) return null;
  const prev = before.slice(-1);
  if (prev && !OPENERS.test(prev)) return null; // part of something bigger: e.g, a.b, co-op
  const plain = word.replace(/’/g, "'");
  const lower = plain.toLowerCase();
  if (leaveAlone.has(lower)) return null;
  const casing = casingOf(plain);
  const sentence = startsSentence(before);
  // "i.e." starts as "i" then "." — don't touch single letters before a full stop.
  const single = word.length === 1;
  if (single && ender === ".") return null;

  let out = word;
  if (lower === "i") out = "I";
  else if (/^i'(m|ve|ll|d)$/.test(lower)) out = "I" + word.slice(1);
  else if (casing !== "mixed") {
    const fix = FIXES.get(lower);
    if (fix) {
      out = fix.startsWith("I") ? fix : applyCasing(fix, casing);
    } else if (casing === "lower") {
      // A capital the writer typed themselves usually means a name: no guessing.
      const g = guess(lower);
      if (g) out = applyCasing(g, casing);
    }
  }
  // Keep a curly apostrophe if that's what was typed.
  if (word.includes("’")) out = out.replace(/'/g, "’");
  if (sentence && /^\p{Ll}/u.test(out)) out = capitalise(out);
  if (out === word) return null;
  return { text: out, capitalOnly: out.toLowerCase() === word.toLowerCase() };
}

/**
 * Find the word that ends `text` (the paragraph up to the cursor).
 * Returns where it starts, or null when the cursor isn't after a word.
 */
export function wordAtEnd(text: string): { start: number; word: string } | null {
  const m = /[\p{L}\p{N}'’]+$/u.exec(text);
  if (!m) return null;
  let word = m[0];
  let start = m.index;
  // Quotes around a word aren't part of it.
  const lead = /^['’]+/.exec(word)?.[0].length ?? 0;
  word = word.slice(lead);
  start += lead;
  if (/['’]$/.test(word)) return null; // a possessive ("dogs'") or a closing quote: leave it
  if (!word) return null;
  return { start, word };
}
