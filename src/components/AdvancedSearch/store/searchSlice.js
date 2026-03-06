/**
 * searchSlice.js
 * ─────────────────────────────────────────────────────────────
 * Redux slice for the advanced search system.
 *
 * Responsibilities:
 *  - Owns all search state (query, results, loading, filters, etc.)
 *  - Exposes synchronous actions for UI interactions
 *  - Exposes async thunks for client search + server fetch + merge
 *  - Is completely decoupled from any UI component
 *
 * The UI never touches state directly — it dispatches actions.
 * The engine (scorer, parser) never touches Redux directly.
 *
 * Dependency direction:
 *   UI → useSearch hook → Redux actions/selectors → Engine (pure)
 */

import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import { parseQuery} from '../engine/queryParser';
import { rankResults, deduplicateBy, } from '../engine/scorer';
import { levenshtein } from '../engine/spellCorrector';
import moduleApis from '../api/searchApi';
import {
  CACHE_TIMEOUT_MS,
  getCacheEntry,
  findBestPrefixCache,
  filterCachedResults,
  setCacheEntry as writeCacheEntry,
  setModuleCacheEntry as writeModuleCacheEntry,
  clearExpiredEntries,
  clearAll as clearAllCacheEntries,
} from './searchCache';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const  DEFAULT_MODULE_WEIGHTS = {
  users:       1.5,
  chats:       1.4,
  channels:    1.2,
  department:  1.1,
  messages:    1.0,
  files:       0.95,
  bots:        0.9,
  threads:     0.85,  
  widgets:     0.75,
  apps:        0.75,
  connections: 0.6,
  settings:    0.6,
};

export const CONTEXT_CATEGORIES = {
  home:            ['all','users','channels','chats','bots','messages','department','threads','widgets'],
  department:      ['users'],
  channels:        ['channels'],
  history:         ['all','channels','direct_messages','group_chats','threads','bots','muted'],
  sent_messages:   ['all','conversations_with','conversation_in'],
  files:           ['all','you','specific_sender','taz'],
  org:             ['users','teams'],
  profile_settings:['settings'],
  connections:     ['connections'],
  apps:            ['apps'],
  create_channel:  ['users'],
  direct_message:  ['users'],
  group_chat:      ['users'],
  make_call:       ['users'],
  create_event:    ['users','conversations','rooms'],
};

const MAX_CLIENT_CHATS   = 5000;
const MAX_CLIENT_USERS   = 5000;
const MAX_HISTORY        = 20;
const HISTORY_STORAGE_KEY = '_adv_search_history';

// ─────────────────────────────────────────────────────────────
// ABORT CONTROLLER REGISTRY
// Lives outside Redux (not serializable, not needed in store)
// ─────────────────────────────────────────────────────────────

let _abortController = null;

function getAbortSignal() {
  if (_abortController) _abortController.abort();
  _abortController = new AbortController();
  return _abortController.signal;
}

// ─────────────────────────────────────────────────────────────
// FIELD RESOLVERS
// ─────────────────────────────────────────────────────────────

/** Map of _module → fields used for scoring/display. */
const MODULE_FIELD_MAP = {
  users:    (i) => [i.full_name, i.email || i.email_id],
  chats:    (i) => [i.dname, i.recipantssummary, i.recipientssumm, i.name, i.title],
  channels: (i) => [i.title],
  messages: (i) => [i.message, i.msg, i.ctitle],
};

const DEFAULT_FIELDS = (i) => [i.name, i.title, i.description, i.full_name];

function getDefaultResolveFields(item) {
  const resolver = MODULE_FIELD_MAP[item._module] ?? DEFAULT_FIELDS;
  return resolver(item).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// DEDUP KEY
// ─────────────────────────────────────────────────────────────

function getDefaultDedupKey(item) {
  if (item._module === 'users') {
    const name = item.full_name || item.name || item.title;
    if (name) return `users::name::${name.toLowerCase()}`;
  }
  return `${item._module ?? 'unknown'}::${item.id ?? item.name ?? Math.random()}`;
}

// ─────────────────────────────────────────────────────────────
// CHAT PARTICIPANT HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Extract the "other" user's ZUID from a 1-1 chat.
 * @param {string|object[]} summary  - recipantssummary (string or array)
 * @param {string}          loggedInZuid - current user's ID (to exclude)
 * @param {string}          [chatTitle]  - optional title for heuristic matching
 * @returns {string|null}
 */
function getOtherUserId(summary, loggedInZuid, chatTitle) {
  try {
    const participants = typeof summary === 'string' ? JSON.parse(summary) : summary || [];
    if (!Array.isArray(participants)) return null;

    const otherUser =
      (loggedInZuid && participants.find(p => String(p.zuid) !== String(loggedInZuid))) ||
      (chatTitle    && participants.find(p => p.dname === chatTitle)) ||
      (participants.length === 1 ? participants[0] : null);

    return otherUser?.zuid || null;
  } catch {
    return null;
  }
}

/** Derive _module from chat_type. */
function chatTypeToModule(chatType) {
  switch (String(chatType)) {
    case '8':  return 'channels';
    case '1':  return 'users';
    case '11': return 'threads';
    case '9':  return 'bot';
    default:   return '';
  }
}

// ─────────────────────────────────────────────────────────────
// THUNK HELPERS  (pure functions extracted from executeSearch)
// ─────────────────────────────────────────────────────────────

/**
 * Build Sets of IDs already present in clientData so we can exclude
 * duplicates when server results arrive.
 */
function buildExclusionSets(chats, users, loggedUserZuid) {
  const existingChatIds = new Set();
  const existingUserIds = new Set();

  chats.forEach(chat => {
    if (chat.chatid) existingChatIds.add(String(chat.chatid));

    if (String(chat.chat_type) === '1') {
      const otherZuid = getOtherUserId(chat.recipantssummary, loggedUserZuid, chat.title);
      if (otherZuid) existingUserIds.add(String(otherZuid));
    }
  });

  users.forEach(u => {
    if (u.zuid) existingUserIds.add(String(u.zuid));
  });

  return { existingChatIds, existingUserIds };
}

/**
 * Client-side search: fast, synchronous filtering of local data.
 *
 * Returns:
 *  - clientChats / clientUsers / clientResults — startsWith-filtered results
 *  - allMappedChats / allMappedUsers — full mapped arrays (for contains search later)
 */
function runClientSearch(chats, users, queryLower, loggedUserZuid) {
  // ── Map all chats (derive _module, _source, id) ──
  const allMappedChats = chats.slice(0, MAX_CLIENT_CHATS)
    .map(c => ({
      ...c,
      title:   c.title.replace(/^[@#]/, ''),
      _module: chatTypeToModule(c.chat_type),
      _source: 'client',
      id:      String(c.chat_type) === '1'
        ? getOtherUserId(c.recipantssummary, loggedUserZuid, c.title) || c.chatid
        : c.chatid,
    }));

  // ── StartsWith filter on chats ──
  const clientChats = allMappedChats
    .filter(c => c.title?.toLowerCase().startsWith(queryLower))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // ZUIDs already covered by 1-1 chats (to avoid user duplicates)
  const clientChatZuids = new Set(
    clientChats.filter(c => c._module === 'users').map(c => String(c.id)),
  );

  // ── Map all users ──
  const allMappedUsers = users.slice(0, MAX_CLIENT_USERS)
    .map(u => ({ ...u, _module: 'users', _source: 'client', id: u.Zuid || u.zuid || u.id }));

  // ── StartsWith filter on users ──
  const clientUsers = allMappedUsers
    .filter(u => {
      const nameMatch  = (u.full_name || u.display_name || '').toLowerCase().startsWith(queryLower);
      const emailMatch = (u.email || u.email_id || '').toLowerCase().startsWith(queryLower);
      return (nameMatch || emailMatch) && !clientChatZuids.has(String(u.id));
    });

  return {
    clientChats, clientUsers,
    clientResults: [...clientChats, ...clientUsers],
    allMappedChats, allMappedUsers,
  };
}

/**
 * Construct the array of server API promises.
 * Also captures globalsearch and users-API results into the provided
 * `captured` object so they can be appended to clientData later.
 *
 * @returns {{ module: string, promise: Promise<object[]> }[]} serverTasks
 */
function buildServerPromises({
  parsedQuery, signal, loggedUserZuid,
  enabledModules, activeCategory,
  existingChatIds, existingUserIds,
  captured,  // { globalSearchResults: [], usersApiResults: [] }
}) {
  const tasks = [];

  // ── Global search API ──
  tasks.push({
    module: 'globalsearch',
    promise: moduleApis.globalsearch(parsedQuery, { signal })
      .then(raw => {
        captured.globalSearchResults = (Array.isArray(raw) ? raw : []).map(item => ({
          ...item,
          _module: item._module || '',
          _source: item._source || 'server',
          id: String(item.chat_type) === '1'
            ? getOtherUserId(item.recipantssummary, loggedUserZuid, item.title) || item.chatid
            : item.chatid,
        }));
        return captured.globalSearchResults;
      })
      .catch(e => {
        if (e?.name !== 'AbortError') console.warn('[Search] Global search failed:', e?.message);
        return [];
      }),
  });

  // ── Users API (captured separately for clientData enrichment) ──
  if (moduleApis.users && enabledModules.includes('users') && (activeCategory === 'all' || activeCategory === 'users')) {
    tasks.push({
      module: 'users',
      promise: moduleApis.users(parsedQuery, { signal })
        .then(raw => {
          const list = Array.isArray(raw) ? raw : [];
          captured.usersApiResults = list
            .map(item => ({ ...item, _module: item._module || 'users', _source: item._source || 'server', id: item.zuid }))
            .filter(item => !existingUserIds.has(String(item.id)));
          return captured.usersApiResults;
        })
        .catch(e => {
          if (e?.name !== 'AbortError') console.warn('[Search] Module "users" failed:', e?.message);
          return [];
        }),
    });
  }

  // ── Generic module helper ──
  const addModule = (mod, apiFn, filterSet, idField) => {
    if (!apiFn) return;
    if (!enabledModules.includes(mod)) return;
    if (activeCategory !== 'all' && activeCategory !== mod) return;

    tasks.push({
      module: mod,
      promise: apiFn(parsedQuery, { signal })
        .then(raw => {
          const list = Array.isArray(raw) ? raw : [];
          return list
            .map(item => ({ ...item, _module: item._module || mod, _source: item._source || 'server', id: item[idField] }))
            .filter(item => !filterSet || !filterSet.has(String(item.id)));
        })
        .catch(e => {
          if (e?.name !== 'AbortError') console.warn(`[Search] Module "${mod}" failed:`, e?.message);
          return [];
        }),
    });
  };

  addModule('chats',       moduleApis.chats,       existingChatIds, 'chatid');
  addModule('channels',    moduleApis.channels,    existingChatIds, 'chatid');
  addModule('bots',        moduleApis.bots,        existingChatIds, 'chatid');
  addModule('threads',     moduleApis.threads,     existingChatIds, 'chatid');
  addModule('messages',    moduleApis.messages,    null,            'msguid');
  addModule('files',       moduleApis.files,       null,            'id');
  addModule('department',  moduleApis.department,  null,            'id');
  addModule('widgets',     moduleApis.widgets,     null,            'id');
  addModule('apps',        moduleApis.apps,        null,            'id');
  addModule('connections', moduleApis.connections, null,            'id');
  addModule('settings',    moduleApis.settings,    null,            'id');

  return tasks;
}

/**
 * Append unique global-search results into `chats` and users-API
 * results into `users` (mutates the arrays in-place).
 */
function enrichClientData({ chats, users, existingChatIds, existingUserIds, captured }) {
  captured.globalSearchResults.forEach(item => {
    if (item.chatid) {
      const cid = String(item.chatid);
      if (!existingChatIds.has(cid)) {
        existingChatIds.add(cid);
        chats.push(item);
      }
    }
  });

  captured.usersApiResults.forEach(item => {
    if (item.zuid) {
      const uid = String(item.zuid);
      if (!existingUserIds.has(uid)) {
        existingUserIds.add(uid);
        users.push(item);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// CONTAINS + FUZZY (TYPO-TOLERANT) SEARCH
// ─────────────────────────────────────────────────────────────

/**
 * Search `items` using **contains** matching AND **Levenshtein
 * typo tolerance**. Returns items not already in `excludeKeys`.
 *
 * A match is found when ANY field of the item satisfies:
 *   1. field.includes(query)        — substring / contains match
 *   2. Any word in the field has Levenshtein distance ≤ maxDistance
 *      from any word in the query   — typo-tolerant match
 *
 * Matched items are added to `excludeKeys` so callers can chain
 * multiple calls without duplicates.
 *
 * @param {Array}    items           - Pre-mapped items (must have _module, id, etc.)
 * @param {string}   queryLower      - Lowercased query string
 * @param {Function} resolveFields   - (item) => string[]
 * @param {Set}      excludeKeys     - Dedup keys of items already in results (mutated)
 * @param {Function} resolveDedupKey - (item) => string
 * @param {number}   [maxDistance=2] - Levenshtein tolerance
 * @returns {Array}  New matches (not in excludeKeys)
 */
function runContainsFuzzySearch(
  items, queryLower, resolveFields,
  excludeKeys, resolveDedupKey, maxDistance = 2,
) {
  const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
  const results = [];

  for (const item of items) {
    const key = resolveDedupKey(item);
    if (excludeKeys.has(key)) continue;

    const fields = resolveFields(item);
    let matched = false;

    for (const rawField of fields) {
      if (!rawField) continue;
      const fieldLower = String(rawField).toLowerCase();

      // ── Contains check (full field, untokenized) ──
      if (fieldLower.includes(queryLower)) {
        matched = true;
        break;
      }

      // ── Typo-tolerant check: full query vs full field string ──
      if (levenshtein(queryLower, fieldLower, maxDistance) <= maxDistance) {
        matched = true;
        break;
      }

      // ── Typo-tolerant check: each query word vs full field string ──
      for (const qw of queryWords) {
        if (levenshtein(qw, fieldLower, maxDistance) <= maxDistance) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (matched) {
      results.push(item);
      excludeKeys.add(key);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// ASYNC THUNK: executeSearch
// The core search pipeline. Runs client + server, merges, scores.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} payload
 * @param {import('../engine/queryParser').ParsedQuery} payload.parsedQuery
 * @param {string}   payload.context
 * @param {string}   payload.activeCategory
 * @param {object}   payload.clientData          - { chats, users }
 * @param {string[]} payload.enabledModules      - array of module names to fetch
 * @param {object}   payload.moduleWeights       - merged weights
 * @param {object}   payload.scorerConfig
 * @param {Function} payload.getFields           - (item) => string[]
 * @param {Function} payload.getDedupKey         - (item) => string
 * @param {number}   payload.minServerLen
 * @param {number}   [payload.maxResults]
 */
export const executeSearch = createAsyncThunk(
  'search/execute',
  async (payload, { rejectWithValue, dispatch, getState }) => {
  
    const {
      parsedQuery, context, activeCategory,
      clientData,
      enabledModules = [],
      moduleWeights, scorerConfig,
      getFields, getDedupKey,
      minServerLen, maxResults,
      loggedUser,
    } = payload;

    // ── 0. Check cache first ──
    const cacheKey = parsedQuery.trimmed.toLowerCase();
    const state = getState();
    const cached = getCacheEntry(state.search.cache, cacheKey);
    
    if (cached) {
      return { results: cached.results, isPartial: false, fromCache: true };
    }

    const signal        = getAbortSignal();
    const resolveFields = getFields   ?? getDefaultResolveFields;
    const resolveDedupKey = getDedupKey ?? getDefaultDedupKey;
    const getWeight     = (item) => moduleWeights[item._module] ?? DEFAULT_MODULE_WEIGHTS[item._module];

    const nearestCache = findBestPrefixCache(state.search.cache, cacheKey);
    let prefixFilteredResults = [];
    if (nearestCache) {
      if (nearestCache.direction === 'longer') {
        // Cached key is longer — every result already contains the query string
        prefixFilteredResults = nearestCache.results;
      } else {
        // Cached key is shorter — narrow down to items matching the longer query
        prefixFilteredResults = filterCachedResults(
          nearestCache.results, parsedQuery.trimmed, resolveFields,
        );
      }
      if (prefixFilteredResults.length > 0) {
        dispatch(searchSlice.actions.updateResults({ results: prefixFilteredResults, isPartial: true }));
      }
    }

    const { chats = [], users = [] } = clientData;
    const loggedUserZuid = loggedUser?.Zuid;

    // ── 1. Build exclusion sets from existing client data ──
    const { existingChatIds, existingUserIds } = buildExclusionSets(chats, users, loggedUserZuid);

    try {
      // ── 2. Client search (synchronous, instant) ──
      const queryLower = parsedQuery.trimmed.toLowerCase();
      const {
        clientChats, clientUsers, clientResults,
        allMappedChats, allMappedUsers,
      } = runClientSearch(chats, users, queryLower, loggedUserZuid);

      

      // Dispatch client results (merge with any prefix-cached results already shown)
      const clientMerged = prefixFilteredResults.length > 0
        ? [
            ...clientResults,
            ...prefixFilteredResults.filter(
              pItem => !clientResults.some(cItem => resolveDedupKey(cItem) === resolveDedupKey(pItem)),
            ),
          ]
        : clientResults;
      dispatch(searchSlice.actions.updateResults({ results: clientMerged, isPartial: true }));

      // ── 3. Server search ──
      // Case 2: if extending a prefix query whose cache had limited results,
      //         always fetch server — the shorter query may not have surfaced
      //         all matches for the longer term.
      const prefixHadLimitedResults = nearestCache != null && nearestCache.totalResultCount < 20;
      const shouldFetchServer = clientChats.length < 15 || clientUsers.length < 15 || prefixHadLimitedResults;
      const captured = { globalSearchResults: [], usersApiResults: [] };

      const serverTasks = shouldFetchServer
        ? buildServerPromises({
            parsedQuery, signal, loggedUserZuid,
            enabledModules, activeCategory,
            existingChatIds, existingUserIds,
            captured,
          })
        : [];

      // Track keys already dispatched to the UI so we only append genuinely new items
      const dispatchedKeys = new Set();
      clientMerged.forEach(item => dispatchedKeys.add(resolveDedupKey(item)));

      const progressiveTasks = serverTasks.map(({ module, promise }) =>
        promise.then((moduleResults) => {
          if (!Array.isArray(moduleResults) || moduleResults.length === 0) return [];

          // Rank only this module's batch
          const ranked = rankResults(
            moduleResults,
            parsedQuery.keywords,
            parsedQuery.phrase,
            resolveFields,
            getWeight,
            scorerConfig,
          );

          // Keep only items not already on screen
          const newItems = deduplicateBy(ranked, resolveDedupKey)
            .filter(item => !dispatchedKeys.has(resolveDedupKey(item)));

          // Register them so later modules won't re-add
          newItems.forEach(item => dispatchedKeys.add(resolveDedupKey(item)));

          if (newItems.length > 0) {
            dispatch(searchSlice.actions.appendResults({ results: newItems }));
           
          }

          return moduleResults;
        }),
      );

      // ── 4. Await all server responses ──
      const serverResponses = await Promise.all(progressiveTasks);
      const rawServer = serverResponses.flat();

      // ── 5. Enrich clientData with unique server results ──
      enrichClientData({ chats, users, existingChatIds, existingUserIds, captured });

      // ── 6. Rank, deduplicate, merge ──
      const serverResults = rankResults(
        rawServer, parsedQuery.keywords, parsedQuery.phrase,
        resolveFields, getWeight, scorerConfig,
      );

      const merged = [
        ...clientResults,
        ...deduplicateBy(serverResults, resolveDedupKey)
          .filter(sItem => !clientResults.some(cItem => resolveDedupKey(cItem) === resolveDedupKey(sItem))),
      ];

      const final = maxResults ? merged.slice(0, maxResults) : merged;

      // ── 7. Cache the startsWith results (per-module) ──
      dispatch(searchSlice.actions.setCacheResults({
        query: parsedQuery.trimmed.toLowerCase(),
        results: final,
      }));

      // ── 8. Contains + fuzzy search on client data ──
      const containsExcludeKeys = new Set(final.map(item => resolveDedupKey(item)));
      const allMappedClient = [...allMappedChats, ...allMappedUsers];
      const per = performance.now();
      const containsClientResults = runContainsFuzzySearch(
        allMappedClient, queryLower, resolveFields,
        containsExcludeKeys, resolveDedupKey,
      );
      console.log(`[Search] Contains+fuzzy client search took ${Math.round(performance.now() - per)}ms `);
      if (containsClientResults.length > 0) {
        dispatch(searchSlice.actions.appendResults({ results: containsClientResults }));
      } 

      // ── 9. Contains + fuzzy search on server data ──
      const t2 = performance.now();
      const containsServerResults = runContainsFuzzySearch(
        rawServer, queryLower, resolveFields,
        containsExcludeKeys, resolveDedupKey,
      );
     // console.log(`[Search] Contains+fuzzy server search took ${Math.round(performance.now() - t2)}ms `);
      if (containsServerResults.length > 0) {
        dispatch(searchSlice.actions.appendResults({ results: containsServerResults }));
      }

      const finalAll = [...final, ...containsClientResults, ...containsServerResults];
      return { results: finalAll, isPartial: false };

    } catch (e) {
      if (e?.name === 'AbortError') return { results: [], aborted: true };
      return rejectWithValue(e?.message ?? 'Search failed');
    }
  },
);

// ─────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]'); } catch { return []; }
}

const initialState = {
  // Query
  query:        '',
  parsedQuery:  parseQuery(''),

  // Results
  results:      [],        // all ranked results
  isLoading:    false,
  error:        null,

  // Cache
  cache: {},  

  // UI state
  isOpen:           false,
  highlightedIndex: -1,
  activeCategory:   'all',
  activeFilters:    {},
  context:    'home',
  searchHistory: loadHistory(),

};

// ─────────────────────────────────────────────────────────────
// SLICE
// ─────────────────────────────────────────────────────────────

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    // ── Query ─────────────────────────────────────────────────
    setQuery(state, action) {
      state.query = action.payload;
      state.parsedQuery = parseQuery(action.payload);
      state.highlightedIndex = -1;
    },

    // ── UI state ──────────────────────────────────────────────
    setOpen(state, action) {
      state.isOpen = action.payload;
    },
    setHighlightedIndex(state, action) {
      state.highlightedIndex = action.payload;
    },
    moveHighlight(state, action) {
      // action.payload: +1 or -1
      const len = state.results.filter(r =>
        state.activeCategory === 'all' || r._module === state.activeCategory
      ).length;
      state.highlightedIndex = Math.max(-1, Math.min(state.highlightedIndex + action.payload, len - 1));
    },

    // ── Category / Filters ────────────────────────────────────
    setActiveCategory(state, action) {
      state.activeCategory = action.payload;
      state.highlightedIndex = -1;
    },
    setContext(state, action) {
      state.context = action.payload;
      state.activeCategory = 'all';
    },
    addFilter(state, action) {
      const { key, value } = action.payload;
      state.activeFilters = { ...state.activeFilters, [key]: value };
      // Rebuild parsedQuery to include new filter
      const filterStr = Object.entries({ ...state.activeFilters, [key]: value })
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      state.parsedQuery = parseQuery(`${state.query} ${filterStr}`);
    },
    removeFilter(state, action) {
      const next = { ...state.activeFilters };
      delete next[action.payload];
      state.activeFilters = next;
      const filterStr = Object.entries(next).map(([k, v]) => `${k}:${v}`).join(' ');
      state.parsedQuery = parseQuery(`${state.query} ${filterStr}`);
    },
    clearFilters(state) {
      state.activeFilters = {};
      state.parsedQuery = parseQuery(state.query);
    },

    // ── History ───────────────────────────────────────────────
    addToHistory(state, action) {
      const q = action.payload?.trim();
      if (!q) return;
      const next = [q, ...state.searchHistory.filter(x => x !== q)].slice(0, MAX_HISTORY);
      state.searchHistory = next;
      try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next)); } catch {}
    },
    clearHistory(state) {
      state.searchHistory = [];
      try { localStorage.removeItem(HISTORY_STORAGE_KEY); } catch {}
    },

    // ── Reset ─────────────────────────────────────────────────
    clearSearch(state) {
      state.query          = '';
      state.parsedQuery    = parseQuery('');
      state.results        = [];
      state.isLoading      = false;
      state.error          = null;
      state.isOpen         = false;
      state.highlightedIndex = -1;
      state.activeFilters  = {};
    },
    resetResults(state) {
      state.results = [];
      state.error   = null;
    },

    // ── Progressive Results Update ────────────────────────────
    updateResults(state, action) {
      state.results = action.payload.results;
      state.isLoading = action.payload.isPartial ?? false;
    },

    // ── Append-only update (push new items to the bottom, no re-render of existing) ──
    appendResults(state, action) {
      state.results = [...state.results, ...action.payload.results];
      // isLoading stays true — more modules may still be pending
    },

    // ── Cache Management ──────────────────────────────────────
    setCacheResults(state, action) {
      const { query, results } = action.payload;
      writeCacheEntry(state.cache, query, results);
    },
    setModuleCache(state, action) {
      const { query, module, results } = action.payload;
      writeModuleCacheEntry(state.cache, query, module, results);
    },
    clearExpiredCache(state) {
      state.cache = clearExpiredEntries(state.cache);
    },
    clearAllCache(state) {
      state.cache = clearAllCacheEntries();
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(executeSearch.pending, (state, action) => {
        state.isLoading = true;
        state.error     = null;
      })
      .addCase(executeSearch.fulfilled, (state, action) => {
        if (action.payload.aborted) return; // stale request cancelled
        state.results     = action.payload.results;
        state.isLoading   = action.payload.isPartial ?? false;
      })
      .addCase(executeSearch.rejected, (state, action) => {
        state.isLoading = false;
        state.error     = action.payload ?? 'Search error';
      });
  },
});

// ─────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────

export const {
  setQuery,
  setOpen,
  setHighlightedIndex,
  moveHighlight,
  setActiveCategory,
  setContext,
  addFilter,
  removeFilter,
  clearFilters,
  addToHistory,
  clearHistory,
  clearSearch,
  resetResults,
  updateResults,
  setCacheResults,
  setModuleCache,
  appendResults,
  clearExpiredCache,
  clearAllCache,
} = searchSlice.actions;

// ─────────────────────────────────────────────────────────────
// SELECTORS
// Fine-grained selectors prevent unnecessary re-renders.
// ─────────────────────────────────────────────────────────────

const sel = (state) => state.search;

export const selectQuery           = (s) => sel(s).query;
export const selectParsedQuery     = (s) => sel(s).parsedQuery;
export const selectAllResults      = (s) => sel(s).results;
export const selectIsLoading       = (s) => sel(s).isLoading;
export const selectError           = (s) => sel(s).error;
export const selectIsOpen          = (s) => sel(s).isOpen;
export const selectHighlightedIndex= (s) => sel(s).highlightedIndex;
export const selectActiveCategory  = (s) => sel(s).activeCategory;
export const selectActiveFilters   = (s) => sel(s).activeFilters;
export const selectContext         = (s) => sel(s).context;
export const selectSearchHistory   = (s) => sel(s).searchHistory;

/** Results filtered by active category */
export const selectFilteredResults = createSelector(
  [selectAllResults, selectActiveCategory],
  (results, activeCategory) => {
    return activeCategory === 'all' ? results : results.filter(r => r._module === activeCategory);
  }
);

/** Count of results per module (for tab badges) */
export const selectCategoryCounts = createSelector(
  [selectAllResults],
  (results) => {
    const counts = { all: results.length };
    for (const item of results) {
      if (item._module) counts[item._module] = (counts[item._module] || 0) + 1;
    }
    return counts;
  }
);

/** Currently highlighted result item */
export const selectHighlightedResult = (s) => {
  const results = selectFilteredResults(s);
  const idx     = sel(s).highlightedIndex;
  return idx >= 0 ? results[idx] : null;
};

/** Available category tabs for current context */
export const selectAvailableCategories = (s) =>
  CONTEXT_CATEGORIES[sel(s).context] ?? ['all'];

export default searchSlice.reducer;