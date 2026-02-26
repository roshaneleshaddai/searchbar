/**
 * scorer.js
 * ─────────────────────────────────────────────────────────────
 * Pure scoring engine. Zero React. Zero Redux. Zero side-effects.
 * Every export is a deterministic function: (input) → output.
 * 100% unit-testable in isolation.
 *
 * Simplified Score formula:
 *   Score is based purely on match type:
 *     - exact:      1.5  (highest - field exactly matches keyword)
 *     - startsWith: 1.0  (high - field starts with keyword)
 *     - afterSpace: 0.6  (medium - keyword after space/word boundary)
 *     - middle:     0.3  (lowest - keyword anywhere in middle)
 */

// ── Default config (override via scorerConfig prop) ──────────
export const DEFAULT_SCORER_CONFIG = {
  matchScores: { exact: 1.5, startsWith: 1.0, afterSpace: 0.6, middle: 0.3 },
};

// ── Match detection ──────────────────────────────────────────
export function detectMatch(kw, field, scores = DEFAULT_SCORER_CONFIG.matchScores) {
  if (!kw || !field) return null;
  const k = kw.toLowerCase().trim();
  const f = field.toLowerCase().trim();
  if (!k || !f) return null;

  if (f === k) {
    return { type: 'exact', score: scores.exact };
  }

  if (f.startsWith(k)) {
    return { type: 'startsWith', score: scores.startsWith };
  }
  
  if (f.includes(' ' + k)) {
    return { type: 'afterSpace', score: scores.afterSpace };
  }
  
  if (f.includes(k)) {
    return { type: 'middle', score: scores.middle };
  }
  
  return null;
}

export function bestFieldMatch(kw, fields, scores = DEFAULT_SCORER_CONFIG.matchScores) {
  let best = null;
 
  for (const f of fields) {
    const m = detectMatch(kw, f, scores);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

/**
 * Multi-keyword scoring strategy:
 *  1. Score the combined phrase (e.g. "alice martin")
 *  2. Score each keyword independently, take the best match
 *  3. Return whichever is higher
 */
export function scoreQuery(keywords, phrase, fields, scores = DEFAULT_SCORER_CONFIG.matchScores) {
  const phraseMatch = keywords.length > 1 ? bestFieldMatch(phrase, fields, scores) : null;

  let bestMatch = null;
  for (const kw of keywords) {
    const m = bestFieldMatch(kw, fields, scores);
    if (m && (!bestMatch || m.score > bestMatch.score)) {
      bestMatch = m;
    }
  }

  const candidates = [phraseMatch, bestMatch].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => b.score > a.score ? b : a);
}

// ── Composite item scorer ────────────────────────────────────
export function computeScore(item, keywords, phrase, fields, rawModuleWeight, cfg = DEFAULT_SCORER_CONFIG) {
  const match = scoreQuery(keywords, phrase, fields, cfg.matchScores);
  if (!match) return null;
  
  const finalScore = match.score * (rawModuleWeight || 1);

  return {
    ...item,
    _score:      +finalScore.toFixed(6),
    _matchType:  match.type,
    _matchScore: +match.score.toFixed(6),
  };
}

// ── Batch rank + deduplicate ─────────────────────────────────
export function rankResults(items, keywords, phrase, getFields, getWeight, cfg = DEFAULT_SCORER_CONFIG) {
  const scored = [];
  for (const item of items) {
    const r = computeScore(item, keywords, phrase, getFields(item), getWeight(item), cfg);
    if (r) scored.push(r);
  }

  return scored.sort((a, b) => b._score - a._score);
}

export function deduplicateBy(items, getKey) {
  const seen = new Map();
  for (const item of items) {
    const k = getKey(item);
    if (!seen.has(k) || item._score > seen.get(k)._score) seen.set(k, item);
  }
  return [...seen.values()].sort((a, b) => b._score - a._score);
}