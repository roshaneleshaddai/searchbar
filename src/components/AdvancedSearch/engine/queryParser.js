/**
 * queryParser.js
 * ─────────────────────────────────────────────────────────────
 * Pure functions. No imports. No side effects.
 * Parses raw search input into a structured ParsedQuery object.
 *
 * Supports filter tokens:
 *   from:@alice  to:@bob  in:#general
 *   after:2024-01-01  before:2024-06-01  on:2024-03-10
 *   filenamehas:report  linkhas:github.com  filehas:pdf  fileobject:invoice
 */

export const FILTER_TOKENS = [
  'from', 'to', 'in', 'after', 'before', 'on',
  'filenamehas', 'linkhas', 'filehas', 'fileobject',
];

const TOKEN_RE = /(\w+):([^\s]+)/g;

/**
 * @typedef {Object} ParsedQuery
 * @property {string}                   raw
 * @property {string}                   trimmed        - Query after filter removal
 * @property {string}                   phrase         - Same as trimmed, for phrase matching
 * @property {string[]}                 keywords       - Individual words
 * @property {boolean}                  isEmpty
 * @property {boolean}                  isMultiWord
 * @property {Record<string, string>}   filters        - Extracted token map
 */

/**
 * Parse a raw query string into a structured ParsedQuery.
 * @param {string} raw
 * @param {string[]} [validTokens]
 * @returns {ParsedQuery}
 */
export function parseQuery(raw = '', validTokens = FILTER_TOKENS) {
  const filters = {};
  const removed = [];

  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(raw)) !== null) {
    const key = m[1].toLowerCase();
    if (validTokens.includes(key)) {
      filters[key] = m[2].replace(/^[@#]/, '');
      removed.push(m[0]);
    }
  }

  let remaining = raw;
  for (const tok of removed) remaining = remaining.replace(tok, '');

  const trimmed  = remaining.replace(/\s+/g, ' ').trim();
  const keywords = trimmed ? trimmed.split(/\s+/) : [];

  return {
    raw,
    trimmed,
    phrase:      trimmed,
    keywords,
    isEmpty:     keywords.length === 0 && Object.keys(filters).length === 0,
    isMultiWord: keywords.length > 1,
    filters,
  };
}

/**
 * Serialize a ParsedQuery back to a stable string.
 */
export function serializeQuery(pq) {
  const filterStr = Object.entries(pq.filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return [pq.trimmed, filterStr].filter(Boolean).join(' ');
}

/** Should we call server APIs for this query? */
export function needsServerFetch(pq, minLen = 3) {
  return pq.trimmed.length >= minLen || Object.keys(pq.filters).length > 0;
}