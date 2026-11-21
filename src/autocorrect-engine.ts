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
import { guessWord, rethinkWord, buildIndex, type Lexicon } from "./autocorrect-guess";

/** Common words in order, most used first (filled in once the list loads). */
let rank: Map<string, number> | null = null;

export function loadWords(text: string) {
  const m = new Map<string, number>();
  let i = 0;
  for (const line of text.split("\n")) {
    // Windows checkouts can add "\r" to each line: strip it.
    let w = line.trim();
    if (!w) continue;
    // "~" marks a word people type but that isn't in the dictionary (often a typo).
    if (w[0] === "~") {
      w = w.slice(1);
      notReal.add(w);
    }
    m.set(w, i++);
  }
  // Hand-picked typos are never "real words", even if people type them a lot.
  for (const k of FIXES.keys()) m.delete(k);
  rank = m;
  lex = { rank: m, notReal, byFirst: buildIndex(m), pairs: lex?.pairs ?? pendingPairs };
}

let lex: Lexicon | null = null;
const notReal = new Set<string>();

/** Word pairs, one per line: "prev next count" (count in thousands). */
export function loadPairs(text: string) {
  const p = new Map<string, number>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(" ");
    if (parts.length === 3) p.set(parts[0] + " " + parts[1], Number(parts[2]));
  }
  if (lex) lex.pairs = p;
  else pendingPairs = p;
}
let pendingPairs: Map<string, number> | null = null;

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
    } else if (casing === "lower" && lex && /^[a-z]+$/.test(lower)) {
      // A capital the writer typed themselves usually means a name: no guessing.
      const g = guessWord(lower, previousWord(before), lex);
      if (g) out = applyCasing(g, casing);
    }
  }
  // Keep a curly apostrophe if that's what was typed.
  if (word.includes("’")) out = out.replace(/'/g, "’");
  if (sentence && /^\p{Ll}/u.test(out)) out = capitalise(out);
  if (out === word) return null;
  return { text: out, capitalOnly: out.toLowerCase() === word.toLowerCase() };
}

/* ------------------------------------------------------------ the word before, again */

/** After "its", these mean "it's": "its been", "its a", "its much better". */
const ITS_NEXT = new Set(
  "a an the not been being going gonna just so very really all too also still more much only like about ok okay fine good great bad nice hard easy true possible important clear funny weird worth getting almost always never quite pretty probably actually definitely no what when how that because raining late early over done up out here there time obvious hot cold cool amazing awesome better worse best worst gone got fun nothing something everything that's also".split(" "),
);
/** After "lets", these mean "let's": "lets go", "lets test". */
const LETS_NEXT = new Set(
  "go see do get make try test talk just not be hope say start have find take play keep look move call eat think put use check give meet stop face pray begin all both talk work write read watch build plan grab head wait leave stay sit focus imagine assume pretend agree hear".split(" "),
);

/**
 * The word before the one just finished, looked at again now that we know
 * what follows it. Returns its replacement, or null to leave it.
 * @param before  the paragraph's text before that earlier word
 * @param word    the earlier word as typed
 * @param next    the word just finished
 */
export function correctPrevious(before: string, word: string, next: string): string | null {
  const ch = before.slice(-1);
  if (ch && !OPENERS.test(ch)) return null;
  const plain = word.replace(/’/g, "'");
  const lower = plain.toLowerCase();
  const n = next.replace(/’/g, "'").toLowerCase();
  if (leaveAlone.has(lower) || casingOf(plain) === "mixed" || casingOf(plain) === "upper") return null;
  let out: string | null = null;
  if (lower === "its" && ITS_NEXT.has(n)) out = "it's";
  else if (lower === "lets" && LETS_NEXT.has(n)) out = "let's";
  else if (lex && casingOf(plain) === "lower" && /^[a-z]+$/.test(lower)) {
    // Unknown words that weren't sure enough alone get a second look with the
    // word after them too ("wnht it" -> "want it"); real words a stricter one.
    out = lex.rank.has(lower) && !lex.notReal.has(lower) ? rethinkWord(lower, n, lex) : guessWord(lower, previousWord(before), lex, n);
  }
  if (!out) return null;
  if (casingOf(plain) === "title") out = capitalise(out);
  if (word.includes("’")) out = out.replace(/'/g, "’");
  return out === word ? null : out;
}

/** The word just before (lower case), if only a space separates them. */
function previousWord(before: string): string | null {
  const m = /([a-z']+) $/i.exec(before);
  return m ? m[1].toLowerCase() : null;
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
