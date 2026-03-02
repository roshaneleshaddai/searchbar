/**
 * searchCache.js
 * ─────────────────────────────────────────────────────────────
 * Dedicated cache module for the advanced search system.
 *
 * Cache structure (per-module):
 * {
 *   [queryKey]: {
 *     modules: {
 *       [moduleName]: {
 *         results: Array,
 *         timestamp: number,
 *       }
 *     }
 *   }
 * }
 *
 * Each module's results are stored separately so they can be
 * retrieved, invalidated, or updated independently.
 */

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const CACHE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─────────────────────────────────────────────────────────────
// SORTED KEY INDEX
// Maintained outside Redux (derived state, not serializable concern).
// Sorted by key length descending so prefix lookups find the
// longest match first and return immediately.
// ─────────────────────────────────────────────────────────────

let _sortedKeys = [];

/**
 * Binary-insert a key into _sortedKeys (sorted by length DESC).
 * No-op if the key already exists.
 */
function indexInsert(key) {
  // Check existence first (small set, indexOf is fine)
  if (_sortedKeys.indexOf(key) !== -1) return;

  let lo = 0;
  let hi = _sortedKeys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (_sortedKeys[mid].length > key.length) lo = mid + 1;
    else hi = mid;
  }
  _sortedKeys.splice(lo, 0, key);
}

/**
 * Remove a key from _sortedKeys.
 */
function indexRemove(key) {
  const idx = _sortedKeys.indexOf(key);
  if (idx !== -1) _sortedKeys.splice(idx, 1);
}

/**
 * Rebuild _sortedKeys from a cache object (e.g. after cleanup).
 */
function indexRebuild(cache) {
  _sortedKeys = Object.keys(cache).sort((a, b) => b.length - a.length);
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Check whether a cache entry (query-level) is still valid.
 * Returns false if *all* module timestamps are expired.
 */
function isEntryValid(entry) {
  if (!entry || !entry.modules) return false;
  const now = Date.now();
  return Object.values(entry.modules).some(
    (mod) => now - mod.timestamp < CACHE_TIMEOUT_MS,
  );
}

/**
 * Check whether a single module's cache is valid (non-expired).
 */
function isModuleValid(moduleEntry) {
  if (!moduleEntry) return false;
  return Date.now() - moduleEntry.timestamp < CACHE_TIMEOUT_MS;
}

/**
 * Split a flat results array into a map of { [_module]: results[] }.
 */
function splitByModule(results) {
  const map = {};
  for (const item of results) {
    const mod = item._module || '_unknown';
    if (!map[mod]) map[mod] = [];
    map[mod].push(item);
  }
  return map;
}

/**
 * Combine per-module results back into a single flat array.
 * Only includes modules whose timestamps are still valid.
 */
function combineModules(entry) {
  if (!entry || !entry.modules) return [];
  const now = Date.now();
  const combined = [];
  for (const [, mod] of Object.entries(entry.modules)) {
    if (now - mod.timestamp < CACHE_TIMEOUT_MS) {
      combined.push(...mod.results);
    }
  }
  return combined;
}

// ─────────────────────────────────────────────────────────────
// GETTERS
// ─────────────────────────────────────────────────────────────

/**
 * Get the combined results for an exact query key.
 * Returns null if not found or expired.
 *
 * @param {object} cache   - The full cache object from Redux state
 * @param {string} query   - The trimmed, lowercased query string
 * @returns {{ results: Array } | null}
 */
export function getCacheEntry(cache, query) {
  const entry = cache[query];
  if (!entry) return null;
  if (!isEntryValid(entry)) return null;

  return {
    results: combineModules(entry),
  };
}

/**
 * Get cached results for a single module within a query.
 * Returns null if not found or expired.
 *
 * @param {object} cache   - The full cache object
 * @param {string} query   - The trimmed, lowercased query string
 * @param {string} module  - Module name (e.g. 'users', 'chats')
 * @returns {{ results: Array, timestamp: number } | null}
 */
export function getModuleCacheEntry(cache, query, module) {
  const entry = cache[query];
  if (!entry || !entry.modules || !entry.modules[module]) return null;
  const modEntry = entry.modules[module];
  if (!isModuleValid(modEntry)) return null;
  return { results: modEntry.results, timestamp: modEntry.timestamp };
}

/**
 * Find the nearest cached query related to the given query.
 * Checks both directions:
 *  - Shorter prefix: cached "ma", query "mark" → filter needed
 *  - Longer superset: cached "marke", query "mark" → use directly
 * Picks the cached key closest in length (smallest edit distance).
 *
 * Uses the sorted key index for efficient traversal.
 *
 * @param {object} cache
 * @param {string} query
 * @returns {{ results: Array, totalResultCount: number, direction: 'shorter'|'longer' } | null}
 */
export function findBestPrefixCache(cache, query) {
  let bestKey = null;
  let bestDist = Infinity;
  let bestDirection = null; // 'shorter' | 'longer'

  for (const key of _sortedKeys) {
    if (key === query) continue; // exact match handled by getCacheEntry
    if (!isEntryValid(cache[key])) continue;

    const dist = Math.abs(key.length - query.length);
    if (dist >= bestDist) continue; // can't improve

    if (key.length < query.length && query.startsWith(key)) {
      // Shorter prefix: cached "ma", query "mark" → needs filtering
      bestKey = key;
      bestDist = dist;
      bestDirection = 'shorter';
    } else if (key.length > query.length && key.startsWith(query)) {
      // Longer superset: cached "marke", query "mark" → use directly
      bestKey = key;
      bestDist = dist;
      bestDirection = 'longer';
    }
  }

  if (!bestKey) return null;

  const results = combineModules(cache[bestKey]);
  return {
    results,
    totalResultCount: results.length,
    direction: bestDirection,
  };
}

/**
 * Get results for a specific module from the best prefix cache.
 * Uses sorted key index for early termination.
 *
 * @param {object} cache
 * @param {string} query
 * @param {string} module
 * @returns {Array | null}
 */
export function getModulePrefixCache(cache, query, module) {
  for (const key of _sortedKeys) {
    if (key.length >= query.length) continue;

    if (
      query.startsWith(key) &&
      isEntryValid(cache[key]) &&
      cache[key].modules?.[module]
    ) {
      const modEntry = cache[key].modules[module];
      return isModuleValid(modEntry) ? modEntry.results : null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// FILTER HELPER
// ─────────────────────────────────────────────────────────────

/**
 * Narrow cached results to only those whose searchable fields
 * still match the longer query string.
 *
 * @param {Array}    cachedResults  - Results from a prefix cache entry
 * @param {string}   longerQuery    - The user's current (longer) query
 * @param {Function} resolveFields  - (item) => string[] of searchable text
 * @returns {Array}
 */
export function filterCachedResults(cachedResults, longerQuery, resolveFields) {
  const q = longerQuery.toLowerCase();
  return cachedResults.filter((item) => {
    const fields = resolveFields(item);
    return fields.some((f) => String(f).toLowerCase().includes(q));
  });
}

// ─────────────────────────────────────────────────────────────
// SETTERS
// ─────────────────────────────────────────────────────────────

/**
 * Store all results for a query, splitting them by module automatically.
 * This replaces the entire cache entry for the given query key.
 *
 * @param {object} cache    - The full cache object (will be mutated — safe inside Immer)
 * @param {string} query    - The trimmed, lowercased query string
 * @param {Array}  results  - Flat array of results (must have _module field)
 */
export function setCacheEntry(cache, query, results) {
  const byModule = splitByModule(results);
  const now = Date.now();
  const modules = {};

  for (const [mod, modResults] of Object.entries(byModule)) {
    modules[mod] = {
      results: modResults,
      timestamp: now,
    };
  }

  cache[query] = { modules };
  indexInsert(query);
}

/**
 * Store (or update) results for a single module within a query key.
 * Preserves other modules' caches for the same query.
 *
 * @param {object} cache    - The full cache object (Immer-safe mutation)
 * @param {string} query    - The trimmed, lowercased query string
 * @param {string} module   - Module name (e.g. 'users', 'channels')
 * @param {Array}  results  - Array of results for this module
 */
export function setModuleCacheEntry(cache, query, module, results) {
  if (!cache[query]) {
    cache[query] = { modules: {} };
    indexInsert(query);
  }
  cache[query].modules[module] = {
    results,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────

/**
 * Remove all expired entries from the cache.
 * Returns a new cache object (suitable for assignment in a reducer).
 *
 * @param {object} cache - The full cache object
 * @returns {object} A new cache object with only valid entries
 */
export function clearExpiredEntries(cache) {
  const validCache = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (isEntryValid(entry)) {
      // Also prune expired modules within a valid entry
      const validModules = {};
      for (const [mod, modEntry] of Object.entries(entry.modules)) {
        if (isModuleValid(modEntry)) {
          validModules[mod] = modEntry;
        }
      }
      if (Object.keys(validModules).length > 0) {
        validCache[key] = { ...entry, modules: validModules };
      }
    }
  }
  indexRebuild(validCache);
  return validCache;
}

/**
 * Return an empty cache object.
 * @returns {object}
 */
export function clearAll() {
  _sortedKeys = [];
  return {};
}
