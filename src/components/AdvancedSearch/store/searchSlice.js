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
import moduleApis from '../api/searchApi';

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

const MAX_CLIENT_CHATS   = 500;
const MAX_CLIENT_USERS   = 100;
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
// HELPERS (used inside thunks)
// ─────────────────────────────────────────────────────────────


function getDefaultResolveFields(item) {
  switch (item._module) {
    case 'users':
      return [
        item.full_name,
        item.email,
      ].filter(Boolean);
    
    case 'chats':
      return [
        item.dname,
        item.recipantssummary,
        item.recipientssumm,
        item.name,
        item.title,
      ].filter(Boolean);
    
    case 'channels':
      return [
        item.title,
        // item.cn,
        // item.dn,
        // item.channelName,
        // item.name,
        // item.description,
      ].filter(Boolean);
    
    case 'messages':
      return [
        item.message,
        item.msg,
        item.ctitle,
      ].filter(Boolean);
    
    case 'department':
    case 'bots':
    case 'threads':
    case 'widgets':
    case 'apps':
    case 'connections':
    case 'settings':
    case 'files':
    default:
      return [
        item.name,
        item.title,
        item.description,
        item.full_name,
      ].filter(Boolean);
  }
}


function getDefaultDedupKey(item) {
  if (item._module === 'users') {
    const name = item.full_name || item.name || item.title;
    if (name) return `users::name::${name.toLowerCase()}`;
  }
  return `${item._module ?? 'unknown'}::${item.id ?? item.name ?? Math.random()}`;
}

/**
 * Helper to extract the "other" user's ZUID from a 1-1 chat.
 * @param {string|object[]} summary - recipantssummary (string or array)
 * @param {string} loggedInZuid - ID of current user (to exclude)
 * @param {string} [chatTitle] - Optional chat title for heuristic matching
 */
function getOtherUserId(summary, loggedInZuid, chatTitle) {
  try {
    const participants = typeof summary === 'string' ? JSON.parse(summary) : summary || [];
    if (!Array.isArray(participants)) return null;

    let otherUser = null;

    // Strategy A: Exclude logged-in user
    if (loggedInZuid) {
      otherUser = participants.find(p => String(p.zuid) !== String(loggedInZuid));
    }

    // Strategy B: Heuristic (Chat Title == User Name)
    if (!otherUser && chatTitle) {
      otherUser = participants.find(p => p.dname === chatTitle);
    }

    // Strategy C: Fallback to first participant if only 1 exists (edge case)
    if (!otherUser && participants.length === 1) {
      otherUser = participants[0];
    }
    
    return otherUser?.zuid || null;
  } catch (e) {
    return null;
  }
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
  async (payload, { rejectWithValue, dispatch }) => {
    const {
      parsedQuery,
      context,
      activeCategory,
      clientData,
      enabledModules = [],
      moduleWeights,
      scorerConfig,
      getFields,
      getDedupKey,
      minServerLen,
      maxResults,
      loggedUser,
    } = payload;

    // ── Abort controller for server calls ──
    const signal = getAbortSignal();

    // ── Field/weight accessors ──
    const resolveFields = getFields ?? getDefaultResolveFields;
    const resolveDedupKey = getDedupKey ?? getDefaultDedupKey;
    const getWeight = (item) => moduleWeights[item._module] ?? DEFAULT_MODULE_WEIGHTS[item._module];

    // ── Build exclusion Sets from client data ──
    const existingChatIds = new Set();
    const existingUserIds = new Set();
    const { chats = [], users = [] } = clientData;

    chats.forEach(chat => {
      // 1. All chats get their ID tracked (for channels, bots, etc.)
      if (chat.chatid) existingChatIds.add(String(chat.chatid));

      // 2. If 1-1 chat (type 1), we also track the other user's ZUID
      if (String(chat.chat_type) === '1') {
        const otherZuid = getOtherUserId(
          chat.recipantssummary, 
          loggedUser?.Zuid, 
          chat.title
        );
        if (otherZuid) {
          existingUserIds.add(String(otherZuid));
        }
      }
    });
    
    // Also track client users
    users.forEach(u => {
      if(u.zuid) existingUserIds.add(String(u.zuid));
    });  
   

    try {
      // ── 1. Client search (synchronous, instant) ──
      const queryLower = parsedQuery.trimmed.toLowerCase();

      // Chats logic: startsWith(title) & sort by score
      const clientChats = chats.slice(0, MAX_CLIENT_CHATS)
        .map(c => ({ 
          ...c, 
          title: c.title.replace(/^[@#]/, ''), 
          _module: c.chat_type == 8 ? 'channels' : c.chat_type == 1 ? 'users' : c.chat_type == 11 ? 'threads' : c.chat_type == 9 ? 'bot' : '',  
          _source: 'client',
          id: c.chat_type == 1 
            ? getOtherUserId(c.recipantssummary, loggedUser?.Zuid, c.title) || c.chatid 
            : c.chatid, // For 1-1 chats, use ZUID to help deduplication with users
        }))
        .filter(c => c.title?.toLowerCase().startsWith(queryLower))
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      // Users logic: startsWith(name/email)
      const clientChatZuids = new Set(
        clientChats
          .filter(c => c._module === 'users')
          .map(c => String(c.id))
      );

      const clientUsers = users.slice(0, MAX_CLIENT_USERS)
        .map(u => ({ 
          ...u, 
          _module: 'users',
          _source: 'client',
          id: u.Zuid || u.zuid || u.id,
        }))
        .filter(u => {
          const nameMatch = (u.full_name || u.display_name || '').toLowerCase().startsWith(queryLower);
          const emailMatch = (u.email || '').toLowerCase().startsWith(queryLower);
          
          // Exclude users already present in clientChats (to avoid duplicates in the combined list)
          const isExcluded = clientChatZuids.has(String(u.id));
          
          return (nameMatch || emailMatch) && !isExcluded;
        });

      const clientResults = [...clientChats, ...clientUsers];

      console.log('Client Results:', clientResults);

      // Dispatch partial results immediately
      dispatch(searchSlice.actions.updateResults({
        results: clientResults,
        isPartial: true,  
      }));

      // ── 2. Server search (Condition: < 15 results in either category) ──
      const serverPromises = [];
      const shouldFetchServer = clientChats.length < 15 || clientUsers.length < 15;

      if (shouldFetchServer) {
        // Global search API
        serverPromises.push(
          moduleApis.globalsearch(parsedQuery, { signal })
            .then(rawGlobal => 
              (Array.isArray(rawGlobal) ? rawGlobal : []).map(item => ({
                ...item,
                _module: item._module || '',
                _source: item._source || 'server',
                id: item.chat_type == 1 ? getOtherUserId(item.recipantssummary, loggedUser?.Zuid, item.title) || item.chatid : item.chatid, // Heuristic for global search chat items
              }))
            )
            .catch(e => {
              if (e?.name !== 'AbortError') {
                console.warn(`[Search] Global search failed:`, e?.message);
              }
              return [];
            })
        );
      

     
      const addModulePromise = (mod, apiFn, filterSet, idField) => {
        if (!apiFn) return;
       
        if (!enabledModules.includes(mod)) return;
        
       
        if (activeCategory !== 'all' && activeCategory !== mod) return;

        serverPromises.push(
          apiFn(parsedQuery, { signal })
            .then(raw => {
              const list = Array.isArray(raw) ? raw : [];
              return list
                .map(item => ({
                  ...item,
                  _module: item._module || mod,
                  _source: item._source || 'server',
                  id: item[idField],
                }))
                // Apply module-specific filtering here
                .filter(item => !filterSet || !filterSet.has(String(item.id)));
            })
            .catch(e => {
              if (e?.name !== 'AbortError') {
                console.warn(`[Search] Module "${mod}" failed:`, e?.message);
              }
              return [];
            })
        );
      };

      
      addModulePromise('users',       moduleApis.users,       existingUserIds, 'zuid');
      addModulePromise('chats',       moduleApis.chats,       existingChatIds, 'chatid');
      addModulePromise('channels',    moduleApis.channels,    existingChatIds, 'chatid');
      addModulePromise('bots',        moduleApis.bots,        existingChatIds, 'chatid');
      addModulePromise('threads',     moduleApis.threads,     existingChatIds, 'chatid');
      addModulePromise('messages',    moduleApis.messages,    null,            'msguid');
      addModulePromise('files',       moduleApis.files,       null,            'id');
      addModulePromise('department',  moduleApis.department,  null,            'id');
      addModulePromise('widgets',     moduleApis.widgets,     null,            'id');
      addModulePromise('apps',        moduleApis.apps,        null,            'id');
      addModulePromise('connections', moduleApis.connections, null,            'id');
      addModulePromise('settings',    moduleApis.settings,    null,            'id');
      }

      // ── 3. Wait for all server results ──
      const serverResponses = await Promise.all(serverPromises);
      const rawServer = serverResponses.flat();
      
      const serverResults = rankResults(
        rawServer,
        parsedQuery.keywords,
        parsedQuery.phrase,
        resolveFields,
        getWeight,
        scorerConfig,
      );
     
      
      const merged = [
        ...clientResults,
        ...deduplicateBy(serverResults, resolveDedupKey)
           .filter(sItem => !clientResults.some(cItem => resolveDedupKey(cItem) === resolveDedupKey(sItem)))
      ];

      // No global re-rank, just slice?
      // const globallyRanked = merged; 

      const final  = maxResults ? merged.slice(0, maxResults) : merged;
      
      return { results: final, isPartial: false };

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

  // UI state
  isOpen:           false,
  highlightedIndex: -1,
  activeCategory:   'all',
  activeFilters:    {},

  // Context
  context:    'home',

  // History
  searchHistory: loadHistory(),

  // Runtime config (set by useSearch on mount, never hardcoded here)
  // These are NOT in the store — they live in the hook.
  // The store is config-agnostic.
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
export const selectFilteredResults = (s) => {
  const { results, activeCategory } = sel(s);
  return activeCategory === 'all' ? results : results.filter(r => r._module === activeCategory);
};

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