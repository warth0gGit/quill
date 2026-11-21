/**
 * Guessing the word you meant, for words that aren't on the hand-picked list.
 *
 * Every nearby common word is a candidate. Each one gets a score made of two
 * parts, the way phone keyboards do it:
 *   - how easy the slip is: swapping two keys, hitting a neighbouring key or
 *     doubling a letter is cheap; changing a letter far away on the keyboard
 *     is expensive; getting the first letter wrong is rarer still;
 *   - how common the word is: "their" beats "theirs" when both are close.
 * The word before helps break ties ("a bog" vs "a big" isn't a guess, but
 * "the fiorst time" → "first" is surer after "the").
 *
 * Quill only changes the word when the best candidate is clearly ahead of the
 * next one, and, for real but rare words, clearly more likely than what was
 * typed.
 *
 * Word lists: word frequencies from wordfreq (Robyn Speer, CC BY-SA 4.0);
 * dictionary check from the word-list package (MIT, from SCOWL); word pairs
 * from SymSpell's bigram list (MIT).
 */

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR = new Map<string, Set<string>>();
for (let r = 0; r < ROWS.length; r++)
  for (let c = 0; c < ROWS[r].length; c++) {
    const n = new Set<string>();
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, -1]]) {
      const ch = ROWS[r + dr]?.[c + dc];
      if (ch) n.add(ch);
    }
    NEAR.set(ROWS[r][c], n);
  }
const near = (a: string, b: string) => NEAR.get(a)?.has(b) ?? false;
const VOWELS = new Set("aeiouy");
/** Letters people swap when spelling by ear: c/s/k, f/ph... kept simple. */
const SOUNDS = new Set(["cs", "sc", "ck", "kc", "sz", "zs", "gj", "jg", "fv", "vf", "mn", "nm", "td", "dt", "bp", "pb"]);

export const TUNE = {
  /** how much one unit of slip counts against how common a word is */
  slipWeight: 4.5,
  /** the best guess must beat the runner-up by this much */
  margin: 1.5,
  /** a rare dictionary word must be this much less likely than the guess to change */
  keepBias: 3,
  /** the same for rare words that aren't in the dictionary ("reciever", "appart") */
  keepBiasNotReal: -1.5,
  /** give up on guesses whose slips add up to more than this */
  maxSlip: 2.6,
  /** how much the word before counts */
  contextWeight: 0.6,
};

let buf = new Float64Array(256);

/** Cost of turning typed `t` into candidate `c`: a weighted edit distance. */
export function slipCost(t: string, c: string, max = 4): number {
  const n = t.length;
  const m = c.length;
  if (Math.abs(n - m) > 2) return max + 1;
  // d[i * W + j]: cost of turning t[0..i) into c[0..j), in one reused buffer
  const W = m + 1;
  if (buf.length < (n + 1) * W) buf = new Float64Array((n + 1) * W * 2);
  const d = buf;
  d[0] = 0;
  for (let i = 1; i <= n; i++) d[i * W] = d[(i - 1) * W] + extraCost(t, i - 1);
  for (let j = 1; j <= m; j++) d[j] = d[j - 1] + missingCost(c, j - 1);
  for (let i = 1; i <= n; i++) {
    let rowMin = Infinity;
    const a = t[i - 1];
    const xc = extraCost(t, i - 1);
    for (let j = 1; j <= m; j++) {
      const b = c[j - 1];
      let v = d[(i - 1) * W + j - 1] + (a === b ? 0 : subCost(a, b));
      const x = d[(i - 1) * W + j] + xc; // typed an extra key
      if (x < v) v = x;
      const y = d[i * W + j - 1] + missingCost(c, j - 1); // missed a key
      if (y < v) v = y;
      if (i > 1 && j > 1 && a === c[j - 2] && t[i - 2] === b && a !== b) {
        const z = d[(i - 2) * W + j - 2] + 0.8; // swapped
        if (z < v) v = z;
      }
      d[i * W + j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  let cost = d[n * W + m];
  if (t[0] !== c[0]) cost += 0.9; // the first letter is rarely wrong
  return cost;
}

function subCost(a: string, b: string): number {
  if (near(a, b)) return 1.0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 1.2; // spelling by ear: seperate, definate
  if (SOUNDS.has(a + b)) return 1.3;
  return 2.0;
}

/** Typed t[i] that isn't in the word. */
function extraCost(t: string, i: number): number {
  const ch = t[i];
  if (t[i - 1] === ch || t[i + 1] === ch) return 0.7; // a doubled key
  if ((t[i - 1] && near(t[i - 1], ch)) || (t[i + 1] && near(t[i + 1], ch))) return 1.0; // brushed a neighbour
  return 1.6;
}

/** Left out c[j]. */
function missingCost(c: string, j: number): number {
  const ch = c[j];
  if (c[j - 1] === ch || c[j + 1] === ch) return 0.7; // one of a double: ocassion
  if (VOWELS.has(ch)) return 1.1; // a skipped vowel: probly
  return 1.3;
}

/* ------------------------------------------------------------ the word lists */

export interface Lexicon {
  rank: Map<string, number>;
  /** rarer words people type that aren't in the dictionary (often typos) */
  notReal: Set<string>;
  /** common words by first letter + length ("a5"), for wider searches */
  byFirst: Map<string, string[]>;
  /** "prev next" -> how often, in thousands (missing = rarely or never) */
  pairs: Map<string, number> | null;
}

/** Only guess towards words in the most common this-many. */
export const TARGETS = 40000;
/** Typed words rarer than this can still be slips ("realy"). */
export const RARE = 50000;

export function buildIndex(rank: Map<string, number>): Map<string, string[]> {
  const byFirst = new Map<string, string[]>();
  for (const [w, r] of rank) {
    if (r >= TARGETS || w.includes("'")) continue;
    const k = w[0] + w.length;
    let list = byFirst.get(k);
    if (!list) byFirst.set(k, (list = []));
    list.push(w);
  }
  return byFirst;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const commonness = (r: number) => Math.log(r + 60);

/** Candidates one edit away (any letter, any place), plus two-edit ones that keep the first letter. */
function candidates(w: string, lex: Lexicon): Set<string> {
  const out = new Set<string>();
  const add = (c: string) => {
    const r = lex.rank.get(c);
    if (r !== undefined && r < TARGETS && c !== w) out.add(c);
  };
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (b) add(a + b.slice(1));
    if (b.length > 1) add(a + b[1] + b[0] + b.slice(2));
    for (const ch of LETTERS) {
      add(a + ch + b);
      if (b) add(a + ch + b.slice(1));
    }
  }
  if (w.length >= 5) {
    const bag = letterBag(w);
    for (let len = w.length - 2; len <= w.length + 2; len++)
      for (const c of lex.byFirst.get(w[0] + len) ?? []) {
        if (out.has(c) || bagDistance(bag, c) > 3) continue;
        if (slipCost(w, c, TUNE.maxSlip) <= TUNE.maxSlip) out.add(c);
      }
  }
  return out;
}

function letterBag(w: string): Int8Array {
  const b = new Int8Array(26);
  for (let i = 0; i < w.length; i++) b[w.charCodeAt(i) - 97]++;
  return b;
}
/** A quick lower bound: letters in one word and not the other. */
function bagDistance(bag: Int8Array, c: string): number {
  const b = bag.slice();
  let extra = 0;
  for (let i = 0; i < c.length; i++) {
    const k = c.charCodeAt(i) - 97;
    if (k < 0 || k > 25) return 99;
    if (b[k] > 0) b[k]--;
    else extra++;
  }
  let left = 0;
  for (let i = 0; i < 26; i++) left += b[i];
  return Math.max(extra, left);
}

/** Bonus for a candidate that often follows the previous word. */
function contextBonus(prev: string | null, c: string, lex: Lexicon): number {
  if (!prev || !lex.pairs) return 0;
  const k = lex.pairs.get(prev + " " + c);
  return k ? Math.min(3, Math.log(1 + k)) : 0;
}

/**
 * The word `w` (lower case, letters only) probably meant, or null.
 * `prev` is the word before it, lower case, if any.
 */
export function guessWord(w: string, prev: string | null, lex: Lexicon): string | null {
  if (w.length < 3) return null;
  const own = lex.rank.get(w);
  if (own !== undefined && own < RARE) return null; // a real word: leave it
  const scored: [string, number][] = [];
  for (const c of candidates(w, lex)) {
    // Plurals and endings are the writer's choice, not a typo.
    if (c + "s" === w || w + "s" === c) continue;
    const slip = slipCost(w, c, TUNE.maxSlip);
    if (slip > TUNE.maxSlip) continue;
    if (w.length <= 4 && slip > 1.3) continue; // short words: one easy slip only
    const score = TUNE.slipWeight * slip + commonness(lex.rank.get(c)!) - TUNE.contextWeight * contextBonus(prev, c, lex);
    scored.push([c, score]);
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => x[1] - y[1]);
  const [best, s] = scored[0];
  if (scored.length > 1 && scored[1][1] - s < TUNE.margin) return null;
  if (own !== undefined) {
    // A real but rare word stays unless the guess is far more likely.
    const keep = commonness(own) - TUNE.contextWeight * contextBonus(prev, w, lex);
    const bias = lex.notReal.has(w) ? TUNE.keepBiasNotReal : TUNE.keepBias;
    if (s + bias > keep) return null;
  }
  return best;
}
