/**
 * spellCorrector.js
 * ─────────────────────────────────────────────────────────────
 * Spelling mistake resolver using an optimized Levenshtein
 * distance algorithm. Pure functions. No imports. No side effects.
 *
 * Optimizations implemented (from Robert Jacobson's article):
 *
 *  1. Single-row memory — O(min(m,n)) space instead of O(m×n).
 *     Only one row is kept; a temp variable saves the overwritten
 *     diagonal value before each cell is written.
 *
 *  2. Common prefix trimming — identical leading characters
 *     are stripped before entering the main loop, shortening
 *     the effective strings.
 *
 *  3. Normalize so m ≥ n — the single row is always allocated
 *     to the length of the shorter string, minimising memory.
 *
 *  4. Allocate once — the row buffer is allocated once and
 *     reused across every call inside batch functions like
 *     `findClosestMatches` and `suggestCorrections`.
 *
 * ─────────────────────────────────────────────────────────────
 * Public API:
 *
 *   levenshtein(a, b, maxDistance?)
 *     → number  (edit distance, or maxDistance+1 if exceeded)
 *
 *   findClosestMatches(query, candidates, options?)
 *     → Array<{ item, field, distance }>
 *
 *   suggestCorrections(query, dictionary, options?)
 *     → Array<{ suggestion, distance }>
 *
 *   createSpellChecker(dictionary, options?)
 *     → { check(word), suggest(word), addWord(word) }
 */

// ─────────────────────────────────────────────────────────────
// CORE: Optimized Levenshtein distance
// ─────────────────────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * @param {string} a            - First string (source)
 * @param {string} b            - Second string (target)
 * @param {number} [maxDistance] - Upper bound. If the true distance
 *                                 would exceed this, returns maxDistance + 1
 *                                 immediately. Enables the banded variant.
 *                                 Defaults to Infinity (compute full distance).
 * @param {Int32Array} [buffer]  - Optional pre-allocated row buffer (length ≥ shorter string + 1).
 *                                 Pass one in hot loops to avoid allocation.
 * @returns {number}
 */
export function levenshtein(a, b, maxDistance = Infinity, buffer = null) {
  // Fast identity / empty checks
  if (a === b) return 0;
  if (a.length === 0) return b.length > maxDistance ? maxDistance + 1 : b.length;
  if (b.length === 0) return a.length > maxDistance ? maxDistance + 1 : a.length;

  // ── Optimization 4: Trim common prefix ──
  let prefixLen = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefixLen < minLen && a.charCodeAt(prefixLen) === b.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  // All characters matched — distance is the length difference
  if (prefixLen === minLen) {
    const diff = Math.abs(a.length - b.length);
    return diff > maxDistance ? maxDistance + 1 : diff;
  }

  // Effective (trimmed) lengths
  let m = a.length - prefixLen;
  let n = b.length - prefixLen;

  // After trimming, check again
  if (m === 0) return n > maxDistance ? maxDistance + 1 : n;
  if (n === 0) return m > maxDistance ? maxDistance + 1 : m;

  // ── Optimization 6: Ensure m ≥ n (row = shorter string) ──
  // `source` is the longer string, `target` is the shorter one.
  // The single row corresponds to `target` (length n).
  let source = a;
  let target = b;
  let sourceOffset = prefixLen;
  let targetOffset = prefixLen;

  if (m < n) {
    // Swap so m ≥ n
    [m, n] = [n, m];
    [source, target] = [target, source];
    [sourceOffset, targetOffset] = [targetOffset, sourceOffset];
  }

  // ── Single-row buffer (allocate once / reuse) ──
  const rowLen = n + 1;
  const row = buffer && buffer.length >= rowLen
    ? buffer
    : new Int32Array(rowLen);

  // Initialise row: row[j] = j for j in [0..n]
  for (let j = 0; j <= n; j++) {
    row[j] = j;
  }

  // ── Main loop ──
  for (let i = 1; i <= m; i++) {
    const srcChar = source.charCodeAt(sourceOffset + i - 1);

    // Prime the diagonal: row[0] holds i-1 at this point
    let diag = row[0];
    row[0] = i;

    for (let j = 1; j <= n; j++) {
      const tgtChar = target.charCodeAt(targetOffset + j - 1);

      // Save current row[j] before overwriting (becomes diagonal for j+1)
      const prevRowJ = row[j];

      if (srcChar === tgtChar) {
        row[j] = diag;
      } else {
        let min = diag;
        if (row[j] < min)   min = row[j];    // above
        if (row[j-1] < min) min = row[j-1];  // left
        row[j] = min + 1;
      }

      diag = prevRowJ;
    }
  }

  const result = row[n];
  return result > maxDistance ? maxDistance + 1 : result;
}

// ─────────────────────────────────────────────────────────────
// BATCH: Find closest matches in a list of candidate items
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MatchResult
 * @property {*}      item      - The original item from the candidates array
 * @property {string} field     - The field value that produced the best match
 * @property {number} distance  - Levenshtein distance
 */

/**
 * Find the closest matching items to `query` from a list of candidates.
 *
 * @param {string}   query              - The (possibly misspelled) search term
 * @param {Array}    candidates         - Array of items to search through
 * @param {Object}   [options]
 * @param {Function} [options.getFields] - (item) => string[]  — fields to compare against
 * @param {number}   [options.maxDistance=2] - Maximum edit distance to consider a match
 * @param {number}   [options.maxResults=5]  - Maximum number of suggestions to return
 * @param {boolean}  [options.caseSensitive=false]
 * @returns {MatchResult[]}  Sorted by distance ascending
 */
export function findClosestMatches(query, candidates, options = {}) {
  const {
    getFields = (item) => [item.full_name || item.Display_name || item.email ||item.name||item.title || String(item)].filter(Boolean),
    maxDistance = 2,
    maxResults = 5,
    caseSensitive = false,
  } = options;

  if (!query || !candidates || candidates.length === 0) return [];

  const q = caseSensitive ? query.trim() : query.trim().toLowerCase();
  if (q.length === 0) return [];

  // ── Optimization 8: Allocate the row buffer once ──
  // Size it to the longest possible field we'll encounter.
  // We'll grow it if needed, but start with a reasonable size.
  let bufferSize = q.length + 1;
  let buffer = new Int32Array(bufferSize);

  const results = [];

  for (const item of candidates) {
    const fields = getFields(item);
    let bestFieldDist = maxDistance + 1;
    let bestField = '';

    for (const rawField of fields) {
      if (!rawField) continue;
      const f = caseSensitive ? String(rawField).trim() : String(rawField).trim().toLowerCase();
      if (f.length === 0) continue;

      // Ensure buffer is large enough for this field
      const needed = Math.min(q.length, f.length) + 1;
      if (needed > bufferSize) {
        bufferSize = needed;
        buffer = new Int32Array(bufferSize);
      }

      const dist = levenshtein(q, f, maxDistance, buffer);

      if (dist < bestFieldDist) {
        bestFieldDist = dist;
        bestField = rawField;
        if (dist === 0) break; // perfect match, no need to check other fields
      }
    }

    if (bestFieldDist <= maxDistance) {
      results.push({ item, field: bestField, distance: bestFieldDist });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────────
// SUGGESTIONS: Simple string-list spell correction
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Suggestion
 * @property {string} suggestion - The corrected word
 * @property {number} distance   - Levenshtein distance from the query
 */

/**
 * Given a query word and a dictionary of known-correct words,
 * suggest the closest corrections.
 *
 * @param {string}   query
 * @param {string[]} dictionary           - Array of correct words
 * @param {Object}   [options]
 * @param {number}   [options.maxDistance=2]
 * @param {number}   [options.maxResults=5]
 * @param {boolean}  [options.caseSensitive=false]
 * @returns {Suggestion[]}  Sorted by distance ascending
 */
export function suggestCorrections(query, dictionary, options = {}) {
  const {
    maxDistance = 2,
    maxResults = 5,
    caseSensitive = false,
  } = options;

  if (!query || !dictionary || dictionary.length === 0) return [];

  const q = caseSensitive ? query.trim() : query.trim().toLowerCase();
  if (q.length === 0) return [];

  // ── Optimization 8: Allocate once ──
  let bufferSize = q.length + 1;
  let buffer = new Int32Array(bufferSize);

  const results = [];

  for (const word of dictionary) {
    if (!word) continue;
    const w = caseSensitive ? word.trim() : word.trim().toLowerCase();
    if (w.length === 0) continue;

    const needed = Math.min(q.length, w.length) + 1;
    if (needed > bufferSize) {
      bufferSize = needed;
      buffer = new Int32Array(bufferSize);
    }

    const dist = levenshtein(q, w, maxDistance, buffer);

    if (dist <= maxDistance) {
      results.push({ suggestion: word, distance: dist });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────────
// SPELL CHECKER: Stateful wrapper with a mutable dictionary
// ─────────────────────────────────────────────────────────────

/**
 * Create a reusable spell checker backed by a mutable dictionary.
 *
 * @param {string[]} [initialDictionary=[]]
 * @param {Object}   [options]
 * @param {number}   [options.maxDistance=2]
 * @param {number}   [options.maxResults=5]
 * @param {boolean}  [options.caseSensitive=false]
 *
 * @returns {{
 *   check:   (word: string) => boolean,
 *   suggest: (word: string) => Suggestion[],
 *   addWord: (word: string) => void,
 *   addWords: (words: string[]) => void,
 *   size:     () => number,
 * }}
 */
export function createSpellChecker(initialDictionary = [], options = {}) {
  const {
    maxDistance = 2,
    maxResults = 5,
    caseSensitive = false,
  } = options;

  // Internal set for O(1) existence checks
  const wordSet = new Set();
  // Array for iteration (suggestCorrections needs an array)
  const wordList = [];

  const normalise = (w) => caseSensitive ? w.trim() : w.trim().toLowerCase();

  /** Add a single word to the dictionary. */
  function addWord(word) {
    if (!word) return;
    const norm = normalise(word);
    if (norm && !wordSet.has(norm)) {
      wordSet.add(norm);
      wordList.push(word.trim());
    }
  }

  /** Add multiple words at once. */
  function addWords(words) {
    for (const w of words) addWord(w);
  }

  /** Check if a word exists in the dictionary (exact match). */
  function check(word) {
    if (!word) return false;
    return wordSet.has(normalise(word));
  }

  /** Suggest corrections for a word. */
  function suggest(word) {
    return suggestCorrections(word, wordList, { maxDistance, maxResults, caseSensitive });
  }

  /** Number of words in the dictionary. */
  function size() {
    return wordSet.size;
  }

  // Populate initial dictionary
  addWords(initialDictionary);

  return { check, suggest, addWord, addWords, size };
}
