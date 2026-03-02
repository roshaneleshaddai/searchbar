# Advanced Search — Complete Process Documentation

> Full end-to-end documentation of how a search query flows from the user's keystroke through every layer of the system, including all conditions, branching logic, and data flow.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer Diagram](#2-layer-diagram)
3. [Phase 1 — User Types a Character (UI Layer)](#3-phase-1--user-types-a-character-ui-layer)
4. [Phase 2 — Query Parsing (Engine Layer)](#4-phase-2--query-parsing-engine-layer)
5. [Phase 3 — The `useSearch` Hook Decides What To Do](#5-phase-3--the-usesearch-hook-decides-what-to-do)
6. [Phase 4 — `executeSearch` Thunk (Core Pipeline)](#6-phase-4--executesearch-thunk-core-pipeline)
   - [Step 0 — Exact Cache Check](#step-0--exact-cache-check)
   - [Step 0b — Prefix Cache Check](#step-0b--prefix-cache-check)
   - [Step 1 — Build Exclusion Sets](#step-1--build-exclusion-sets)
   - [Step 2 — Client Search (Synchronous)](#step-2--client-search-synchronous)
   - [Step 3 — Server Search Decision](#step-3--server-search-decision)
   - [Step 4 — Progressive Server Resolution](#step-4--progressive-server-resolution)
   - [Step 5 — Enrichment](#step-5--enrichment)
   - [Step 6 — Final Rank, Dedup, Merge](#step-6--final-rank-dedup-merge)
   - [Step 7 — Cache the Results](#step-7--cache-the-results)
7. [Scoring Engine](#7-scoring-engine)
8. [Deduplication Strategy](#8-deduplication-strategy)
9. [Abort / Cancellation](#9-abort--cancellation)
10. [Redux State Shape & Reducers](#10-redux-state-shape--reducers)
11. [Cache System — Full Behavior](#11-cache-system--full-behavior)
12. [Module Weights](#12-module-weights)
13. [Context & Category System](#13-context--category-system)
14. [Complete Flowchart (Text)](#14-complete-flowchart-text)

---

## 1. Architecture Overview

```
UI Components (AdvancedSearch.jsx)
        │
        │  renders via
        ▼
SearchPrimitive.* (headless compound components)
        │
        │  powered by
        ▼
useSearch() hook (bridge layer)
        │
        │  dispatches actions / reads selectors
        ▼
Redux Store — searchSlice.js
        │
        │  calls pure functions from
        ▼
Engine Layer — queryParser.js + scorer.js
        │
        │  data fetched from
        ▼
API Layer — searchApi.js (real or mock)
```

**Dependency direction (strictly one-way):**

```
UI → Primitives → Hook → Redux → Engine (pure)
```

No layer reaches upward. The engine never imports Redux. The hook never imports React components.

---

## 2. Layer Diagram

| Layer | File(s) | Responsibility |
|---|---|---|
| **Entry Point** | `index.jsx` | Mounts `<AdvancedSearch>` with `context`, `clientData`, `enabledModules`, `loggedUser` |
| **UI** | `AdvancedSearch.jsx` | Styling, icons, layout. Zero Redux imports. |
| **Primitives** | `SearchPrimitive.jsx` | Headless compound components (`Root`, `Input`, `Results`, etc.) |
| **Hook** | `useSearch.js` | Bridge: connects Redux ↔ UI. Manages debouncing, config refs, prop getters. |
| **Store** | `searchSlice.js` | Redux slice: state, reducers, async thunk, selectors. All search logic. |
| **Engine** | `queryParser.js` | Parses raw string → `ParsedQuery` (keywords, phrase, filters). |
| **Engine** | `scorer.js` | Pure scoring: `detectMatch`, `scoreQuery`, `rankResults`, `deduplicateBy`. |
| **API** | `searchApi.js` | Server API adapters (real `fetch` or mock with `servermockData.js`). |

---

## 3. Phase 1 — User Types a Character (UI Layer)

### What happens:

1. User types into `<input>` which has props spread from `getInputProps()`.
2. The `onChange` handler calls `handleQueryChange(value)` in the hook.

### `handleQueryChange` logic:

```
handleQueryChange(value)
  │
  ├── 1. dispatch(setQuery(value))
  │       → Redux immediately updates state.query
  │       → Redux calls parseQuery(value) → updates state.parsedQuery
  │       → Resets highlightedIndex to -1
  │
  ├── 2. Calls onQueryChange callback (if provided)
  │
  ├── 3. Clears any existing debounce timer
  │
  └── 4. Sets new debounce timer (default: 600ms)
          │
          └── After 600ms, reads fresh state from Redux
              and calls triggerSearch(parsedQuery, activeCategory)
```

### Conditions:
- **Debounce**: Every keystroke resets the 600ms timer. The search only fires 600ms after the user *stops* typing.
- **Input props include**: `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, keyboard handlers for Arrow/Enter/Escape.

---

## 4. Phase 2 — Query Parsing (Engine Layer)

**File:** `queryParser.js`

`parseQuery(raw)` converts the raw string into a structured object:

```js
parseQuery("alice from:@bob in:#general")
// Returns:
{
  raw:         "alice from:@bob in:#general",
  trimmed:     "alice",
  phrase:      "alice",
  keywords:    ["alice"],
  isEmpty:     false,
  isMultiWord: false,
  filters:     { from: "bob", in: "general" },
}
```

### Filter tokens recognized:
`from`, `to`, `in`, `after`, `before`, `on`, `filenamehas`, `linkhas`, `filehas`, `fileobject`

### Parsing steps:
1. Extract all `key:value` tokens matching known filter names
2. Remove extracted tokens from the raw string
3. Collapse whitespace → `trimmed`
4. Split by whitespace → `keywords`
5. Set flags: `isEmpty`, `isMultiWord`

### `needsServerFetch(parsedQuery, minLen)` — returns `true` if:
- `trimmed.length >= minLen` (default 3), OR
- At least one filter is active

---

## 5. Phase 3 — The `useSearch` Hook Decides What To Do

**File:** `useSearch.js`

### `triggerSearch(parsedQuery, category)` — the dispatch gateway:

```
triggerSearch(pq, category)
  │
  ├── CONDITION: pq.isEmpty OR !needsServerFetch(pq, minServerLen)?
  │     YES → dispatch(resetResults()) → return (no search)
  │
  ├── CONDITION: queryKey === lastExecutedKeyRef?
  │     YES → return (duplicate, skip)
  │
  └── NO to both → dispatch(executeSearch({ ...fullPayload }))
```

### Payload assembled:
| Field | Source |
|---|---|
| `parsedQuery` | From Redux `state.search.parsedQuery` |
| `context` | From prop or Redux |
| `activeCategory` | From Redux |
| `clientData` | From prop `{ chats: [], users: [] }` |
| `enabledModules` | From prop (array of module name strings) |
| `moduleWeights` | `DEFAULT_MODULE_WEIGHTS` merged with `moduleConfig` overrides |
| `scorerConfig` | Default or custom scorer configuration |
| `getFields` | Field resolver function (module-specific) |
| `getDedupKey` | Deduplication key function |
| `minServerLen` | Default 3 |
| `maxResults` | Optional cap |
| `loggedUser` | Current user object |

---

## 6. Phase 4 — `executeSearch` Thunk (Core Pipeline)

**File:** `searchSlice.js` — `createAsyncThunk('search/execute', ...)`

This is the heart of the system. Here's every step with all conditions:

---

### Step 0 — Exact Cache Check

```
cacheKey = parsedQuery.trimmed.toLowerCase()

CONDITION: cache[cacheKey] exists
  AND cache[cacheKey].activeCategory === activeCategory
  AND (Date.now() - cache[cacheKey].timestamp) < 10 minutes?

  YES → return { results: cached.results, isPartial: false, fromCache: true }
         (thunk exits immediately, no network calls)

  NO  → continue to Step 0b
```

**When this triggers:** User typed the exact same query recently (within 10 minutes), in the same category tab.

---

### Step 0b — Prefix Cache Check

```
Find the longest cached key K where:
  - K.length < cacheKey.length
  - cacheKey.startsWith(K)
  - cache[K].activeCategory === activeCategory
  - (Date.now() - cache[K].timestamp) < 10 minutes

CONDITION: Found a prefix cache entry?
  YES →
    1. Filter cached results to only items whose searchable fields
       contain the longer query string (case-insensitive .includes())
    2. If any filtered results exist:
       dispatch(updateResults({ results: prefixFilteredResults, isPartial: true }))
       → UI instantly shows these (before client search even runs)

  NO  → prefixFilteredResults = [] (no instant preview)
```

**Example:**
- Cache has `"market"` → 7 results (Market Analytics, Marketing Lead, Marketing Manager, ...)
- User types `"marketing"`
- Prefix cache finds `"market"`, filters its 7 results to only those containing "marketing"
- Instantly shows: Marketing Lead, Marketing Manager, Marketing Strategist, Marketing Intern (4 results)
- Market Analytics and Market Ops are filtered OUT (they don't contain "marketing")

---

### Step 1 — Build Exclusion Sets

```
For each chat in clientData.chats:
  - Add chat.chatid to existingChatIds set
  - If chat_type === '1' (1-1 chat):
    - Extract the other user's ZUID → add to existingUserIds set

For each user in clientData.users:
  - Add user.zuid to existingUserIds set
```

**Purpose:** When server results arrive, any item whose ID is already in these sets is skipped (prevents duplicates between client and server data).

---

### Step 2 — Client Search (Synchronous)

```
runClientSearch(chats, users, queryLower, loggedUserZuid)
```

**Client Chats filtering:**
1. Take first 500 chats (`MAX_CLIENT_CHATS`)
2. Strip leading `@` or `#` from title
3. Derive `_module` from `chat_type`: `8→channels`, `1→users`, `11→threads`, `9→bot`
4. Set `_source: 'client'`
5. For 1-1 chats (`chat_type === '1'`): ID = other user's ZUID
6. For others: ID = chatid
7. **Filter condition:** `title.toLowerCase().startsWith(queryLower)`
8. Sort by existing `score` field (descending)

**Client Users filtering:**
1. Take first 100 users (`MAX_CLIENT_USERS`)
2. Tag with `_module: 'users'`, `_source: 'client'`
3. **Filter conditions** (must match at least one):
   - `full_name` or `display_name` `.startsWith(queryLower)`
   - `email` `.startsWith(queryLower)`
4. **Exclusion condition:** Skip users whose ZUID is already in a 1-1 chat result (prevents showing both the chat and the user)

**Output:** `clientResults = [...clientChats, ...clientUsers]`

### Merge with prefix cache results:

```
CONDITION: prefixFilteredResults.length > 0?
  YES → clientMerged = [
          ...clientResults,
          ...prefixFilteredResults that are NOT duplicates of clientResults
        ]
  NO  → clientMerged = clientResults

dispatch(updateResults({ results: clientMerged, isPartial: true }))
→ UI immediately shows client + prefix-cached results
```

---

### Step 3 — Server Search Decision

```
CONDITION: Should we call server APIs?

  shouldFetchServer = true IF ANY of:
    a) clientChats.length < 15
    b) clientUsers.length < 15
    c) prefixCache had limited results (prefixCache.results.length < 20)

  If shouldFetchServer = false → skip to Step 6 with empty server results
```

### Server tasks built by `buildServerPromises()`:

**Always included:**
- `globalsearch` — calls `moduleApis.globalsearch(parsedQuery, { signal })`

**Conditionally included (each requires ALL conditions true):**

| Module | Conditions |
|---|---|
| `users` | `moduleApis.users` exists AND `enabledModules.includes('users')` AND (`activeCategory === 'all'` OR `activeCategory === 'users'`) |
| `chats` | `moduleApis.chats` exists AND `enabledModules.includes('chats')` AND (`activeCategory === 'all'` OR `activeCategory === 'chats'`) |
| `channels` | Same pattern... |
| `bots` | Same pattern... |
| `threads` | Same pattern... |
| `messages` | Same pattern... |
| `files` | Same pattern... |
| `department` | Same pattern... |
| `widgets` | Same pattern... |
| `apps` | Same pattern... |
| `connections` | Same pattern... |
| `settings` | Same pattern... |

**Exclusion filters applied to server results:**
- `chats`, `channels`, `bots`, `threads`: filtered against `existingChatIds`
- `users`: filtered against `existingUserIds`
- `messages`, `files`, `department`, `widgets`, `apps`, `connections`, `settings`: no exclusion filter

Each server promise has a `.catch()` that:
- Returns `[]` on failure (doesn't reject the batch)
- Logs a warning (unless it's an `AbortError`)

---

### Step 4 — Progressive Server Resolution

**Each module promise resolves independently.** When a module completes:

```
For each resolved module:
  │
  ├── CONDITION: moduleResults is empty array?
  │     YES → skip (return [])
  │
  └── NO →
        1. Rank this module's results using scorer.rankResults()
        2. Deduplicate using scorer.deduplicateBy()
        3. Filter out items already dispatched (tracked via dispatchedKeys Set)
        4. Add new items' keys to dispatchedKeys
        5. CONDITION: newItems.length > 0?
             YES → dispatch(appendResults({ results: newItems }))
                   → UI appends at the bottom WITHOUT re-rendering existing items
             NO  → skip
```

**Key behavior:**
- `appendResults` does NOT replace the results array — it concatenates
- `dispatchedKeys` Set starts seeded from `clientMerged` items
- Each module only dispatches items not already on screen
- Items are ranked within their own batch (preserves module-weight ordering)
- **No waiting** — if users API finishes first, those results appear immediately while messages API is still loading

---

### Step 5 — Enrichment

```
enrichClientData({ chats, users, existingChatIds, existingUserIds, captured })
```

After all server promises finish, this mutates the original `clientData` arrays to include server-sourced items:

- **Global search results** → unique ones added to `chats` array
- **Users API results** → unique ones added to `users` array

**Purpose:** Ensures that the next time `runClientSearch` runs for a similar query, these server-discovered items are available locally.

---

### Step 6 — Final Rank, Dedup, Merge

```
1. rawServer = all server responses flattened

2. serverResults = rankResults(rawServer, keywords, phrase, resolveFields, getWeight, scorerConfig)
   → scored + sorted by _score descending

3. merged = [
     ...clientResults,
     ...deduplicateBy(serverResults, resolveDedupKey)
       .filter(sItem => not a duplicate of any clientResult)
   ]

4. CONDITION: maxResults specified?
     YES → final = merged.slice(0, maxResults)
     NO  → final = merged (all results)
```

---

### Step 7 — Cache the Results

```
dispatch(setCacheEntry({
  key:   cacheKey,   // e.g. "marketing"
  value: {
    results:        final,
    timestamp:      Date.now(),
    activeCategory: activeCategory,
  },
}))
```

**Cache entry structure:**
```js
state.cache = {
  "market":    { results: [...], timestamp: 1709337600000, activeCategory: "all" },
  "marketing": { results: [...], timestamp: 1709337602000, activeCategory: "all" },
}
```

### Return value:
```js
return { results: final, isPartial: false }
```

The `extraReducers` handler for `executeSearch.fulfilled` sets:
- `state.results = final`
- `state.isLoading = false`

---

## 7. Scoring Engine

**File:** `scorer.js`

### Match types (from highest to lowest score):

| Type | Score | Condition |
|---|---|---|
| `exact` | 1.5 | Field value exactly equals the keyword |
| `startsWith` | 1.0 | Field value starts with the keyword |
| `afterSpace` | 0.6 | Keyword appears after a space in the field (word boundary) |
| `middle` | 0.3 | Keyword appears anywhere inside the field |

### `computeScore(item, keywords, phrase, fields, moduleWeight, config)`:

1. For multi-word queries: check if the full phrase matches any field
2. Check each keyword independently against all fields
3. Take the highest-scoring match
4. Multiply by `moduleWeight` → final `_score`

### `rankResults(items, keywords, phrase, getFields, getWeight, config)`:

1. Score every item
2. Discard items with no match (score = null)
3. Sort by `_score` descending

---

## 8. Deduplication Strategy

### `getDefaultDedupKey(item)`:

```
IF item._module === 'users':
  key = "users::name::${full_name.toLowerCase()}"
ELSE:
  key = "${_module}::${id}"
```

### `deduplicateBy(items, getKey)`:

- Uses a `Map<string, item>`
- If two items share the same key, keeps the one with the higher `_score`
- Returns sorted by `_score` descending

---

## 9. Abort / Cancellation

**Mechanism:** Single global `AbortController` (lives outside Redux).

```
Every new search call:
  1. If previous controller exists → abort it
  2. Create new AbortController
  3. Pass signal to all API calls

If user types again before searches finish:
  → Old requests get aborted (DOMException 'AbortError')
  → AbortError is caught and returns { results: [], aborted: true }
  → fulfilled handler checks: if (payload.aborted) return; // no state update
```

---

## 10. Redux State Shape & Reducers

### State:

```js
{
  query:            '',          // Raw input string
  parsedQuery:      ParsedQuery, // Structured query object
  results:          [],          // Current displayed results
  isLoading:        false,       // True during search
  error:            null,        // Error message string
  cache:            {},          // { [queryKey]: { results, timestamp, activeCategory } }
  isOpen:           false,       // Dropdown open?
  highlightedIndex: -1,          // Keyboard navigation index
  activeCategory:   'all',       // Current tab filter
  activeFilters:    {},          // Active filter tokens
  context:          'home',      // Current page context
  searchHistory:    [],          // Recent searches (persisted to localStorage)
}
```

### Key Reducers:

| Reducer | Effect |
|---|---|
| `setQuery(value)` | Updates query + parsedQuery + resets highlight |
| `updateResults({ results, isPartial })` | **Replaces** entire results array. Sets `isLoading = isPartial`. |
| `appendResults({ results })` | **Appends** to existing results. `isLoading` stays unchanged. |
| `setActiveCategory(cat)` | Switches tab + resets highlight |
| `setContext(ctx)` | Changes context + resets category to 'all' |
| `addFilter({ key, value })` | Adds filter + rebuilds parsedQuery with filters |
| `clearSearch()` | Resets everything to initial state |
| `setCacheEntry({ key, value })` | Stores query results in cache |
| `clearExpiredCache()` | Removes entries older than 10 minutes |

### Extra Reducers (thunk lifecycle):

| Case | Effect |
|---|---|
| `pending` | `isLoading = true`, `error = null` |
| `fulfilled` | If not aborted: `results = payload.results`, `isLoading = false` |
| `rejected` | `isLoading = false`, `error = payload` |

---

## 11. Cache System — Full Behavior

### Cache Entry Lifecycle:

1. **Write:** After every successful search, `setCacheEntry` stores `{ results, timestamp, activeCategory }`
2. **Exact Hit:** If same query + same category + age < 10 min → return cached, skip everything
3. **Prefix Hit:** If typing an extension of a cached query → instantly filter + display cached results
4. **Expiry:** `clearExpiredCache` runs every 5 minutes (via `useEffect` interval in hook)
5. **Clear All:** `clearAllCache` available for manual reset

### Prefix Cache — Detailed Logic:

```
User types "marketing", cache has "mar" and "market":

findBestPrefixCache() scans ALL cache keys:
  "mar"    → length 3, "marketing".startsWith("mar")    ✓, same category ✓, not expired ✓
  "market" → length 6, "marketing".startsWith("market") ✓, same category ✓, not expired ✓

  Picks "market" (longest match, length 6 > 3)

filterCachedResults(cache["market"].results, "marketing", resolveFields):
  For each cached item, check if ANY of its searchable fields
  .toLowerCase().includes("marketing")

  "Market Analytics"    → fields: ["Market Analytics", email] → none contain "marketing" → EXCLUDED
  "Marketing Lead"      → fields: ["Marketing Lead", email]   → contains "marketing"     → INCLUDED
  "Marketing Manager"   → INCLUDED
  "#marketing-updates"  → title field contains "marketing"     → INCLUDED

→ Instantly dispatched to UI while full search runs in background
```

### Cache Invalidation Conditions:

| Condition | Behavior |
|---|---|
| Same query, same category, < 10 min | Full cache hit, no network calls |
| Same query, different category | Cache miss, full search |
| Same query, same category, ≥ 10 min | Cache expired, full search |
| Prefix query exists, < 20 results | Prefix preview shown + always fetch server |
| Prefix query exists, ≥ 20 results | Prefix preview shown + normal server decision applies |

---

## 12. Module Weights

Weights multiply the match score to prioritize certain modules in ranking:

| Module | Weight | Rationale |
|---|---|---|
| `users` | 1.5 | People are the most common search target |
| `chats` | 1.4 | Recent conversations are highly relevant |
| `channels` | 1.2 | Group spaces |
| `department` | 1.1 | Organizational units |
| `messages` | 1.0 | Baseline |
| `files` | 0.95 | Slightly below messages |
| `bots` | 0.9 | Less frequent target |
| `threads` | 0.85 | Sub-conversations |
| `widgets` | 0.75 | Lower priority |
| `apps` | 0.75 | Same as widgets |
| `connections` | 0.6 | Rarely searched |
| `settings` | 0.6 | Rarely searched |

**Effect:** A user result with `startsWith` match (1.0) × weight (1.5) = 1.5 score will appear above a message result with `exact` match (1.5) × weight (1.0) = 1.5 score (tie, user appears first due to array order from client results).

---

## 13. Context & Category System

### Context:
The `context` prop determines which category tabs are available:

```js
"home"             → ['all','users','channels','chats','bots','messages','department','threads','widgets']
"department"       → ['users']
"channels"         → ['channels']
"history"          → ['all','channels','direct_messages','group_chats','threads','bots','muted']
"create_channel"   → ['users']
"direct_message"   → ['users']
"files"            → ['all','you','specific_sender','taz']
"org"              → ['users','teams']
"profile_settings" → ['settings']
// ... etc.
```

### Category impact on server calls:
- `activeCategory === 'all'` → all enabled module APIs are called
- `activeCategory === 'users'` → only `globalsearch` + `users` API called
- `activeCategory === 'messages'` → only `globalsearch` + `messages` API called

### Category impact on displayed results:
`selectFilteredResults` filters `state.results` by `_module`:
- `'all'` → show everything
- `'users'` → only items where `_module === 'users'`

---

## 14. Complete Flowchart (Text)

```
USER TYPES "marketing"
        │
        ▼
┌─ handleQueryChange("marketing") ─────────────────────────────────┐
│  1. dispatch(setQuery("marketing"))                               │
│     → state.query = "marketing"                                   │
│     → state.parsedQuery = parseQuery("marketing")                 │
│       { trimmed: "marketing", keywords: ["marketing"],            │
│         isEmpty: false, filters: {} }                             │
│  2. Clear previous debounce timer                                 │
│  3. Start new 600ms debounce timer                                │
└───────────────────────────────────────────────────────────────────┘
        │
        │  (600ms passes, no more keystrokes)
        ▼
┌─ triggerSearch(parsedQuery, "all") ────────────────────────────────┐
│  CHECK: isEmpty?               → NO                               │
│  CHECK: needsServerFetch?      → YES (length 9 >= 3)             │
│  CHECK: duplicate queryKey?    → NO                               │
│  → dispatch(executeSearch({ ... }))                               │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ executeSearch thunk ─────────────────────────────────────────────┐
│                                                                   │
│  ┌─ Step 0: Exact Cache ──────────────────────────────────────┐   │
│  │  cache["marketing"] exists + same category + < 10 min?     │   │
│  │  → NO → continue                                          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 0b: Prefix Cache ────────────────────────────────────┐   │
│  │  Scan cache keys: "market" startsWith "marketing"? NO      │   │
│  │  Wait — "marketing".startsWith("market")? YES!             │   │
│  │  "market" is best prefix (length 6)                        │   │
│  │                                                            │   │
│  │  Filter "market" results for "marketing":                  │   │
│  │    Marketing Lead     ✓ (contains "marketing")             │   │
│  │    Marketing Manager  ✓                                    │   │
│  │    Market Analytics   ✗ (no "marketing")                   │   │
│  │                                                            │   │
│  │  → dispatch(updateResults(filtered, isPartial: true))      │   │
│  │  → UI instantly shows matching subset                      │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 1: Build Exclusion Sets ─────────────────────────────┐   │
│  │  existingChatIds = Set of all clientData chat IDs          │   │
│  │  existingUserIds = Set of all client user ZUIDs            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 2: Client Search ────────────────────────────────────┐   │
│  │  clientChats = chats where title.startsWith("marketing")   │   │
│  │  clientUsers = users where name.startsWith("marketing")    │   │
│  │  clientResults = [...clientChats, ...clientUsers]           │   │
│  │                                                            │   │
│  │  Merge with prefix results (dedup by key):                 │   │
│  │  clientMerged = clientResults + unique prefix results       │   │
│  │                                                            │   │
│  │  → dispatch(updateResults(clientMerged, isPartial: true))  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 3: Server Decision ──────────────────────────────────┐   │
│  │  shouldFetchServer = true IF:                              │   │
│  │    clientChats < 15  OR                                    │   │
│  │    clientUsers < 15  OR                                    │   │
│  │    prefix cache had < 20 results                           │   │
│  │                                                            │   │
│  │  Build server tasks:                                       │   │
│  │    ✓ globalsearch (always)                                 │   │
│  │    ✓ users (if enabled + category matches)                 │   │
│  │    ✓ messages (if enabled + category matches)              │   │
│  │    ... etc.                                                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 4: Progressive Resolution ──────────────────────────┐   │
│  │                                                            │   │
│  │  dispatchedKeys = Set(keys from clientMerged)              │   │
│  │                                                            │   │
│  │  [users API resolves first]                                │   │
│  │    → rank this batch                                       │   │
│  │    → filter out already-dispatched keys                    │   │
│  │    → dispatch(appendResults(newItems))                     │   │
│  │    → UI appends at bottom (no re-render of existing)       │   │
│  │                                                            │   │
│  │  [globalsearch resolves next]                              │   │
│  │    → rank this batch                                       │   │
│  │    → filter out already-dispatched keys                    │   │
│  │    → dispatch(appendResults(newItems))                     │   │
│  │    → UI appends new items at bottom                        │   │
│  │                                                            │   │
│  │  [messages API resolves last]                              │   │
│  │    → same process                                          │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 5: Enrichment ──────────────────────────────────────┐   │
│  │  Add unique server chats to clientData.chats               │   │
│  │  Add unique server users to clientData.users               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 6: Final Merge ─────────────────────────────────────┐   │
│  │  Re-rank ALL server results together                       │   │
│  │  Deduplicate                                               │   │
│  │  Merge: clientResults first, then unique server results    │   │
│  │  Apply maxResults cap if set                               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Step 7: Cache ───────────────────────────────────────────┐   │
│  │  cache["marketing"] = { results, timestamp, category }     │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  return { results: final, isPartial: false }                      │
│  → fulfilled handler: state.results = final, isLoading = false    │
└───────────────────────────────────────────────────────────────────┘
```

---

## Error Handling Summary

| Error | Handling |
|---|---|
| Individual module API failure | Catches error, returns `[]`, logs warning. Does NOT fail the search. |
| AbortError (user typed again) | Returns `{ results: [], aborted: true }`. Fulfilled handler ignores it. |
| All modules fail | Search completes with only client results. |
| Thunk rejection | `state.error` set, `isLoading = false`. |
| localStorage failure (history) | Silently caught, history not persisted. |
| JSON parse failure (cache/history) | Returns empty array fallback. |

---

## UI Update Timeline (Visual)

```
Time →
  0ms     User types "marketing"
  0ms     setQuery dispatched (parsedQuery updated)
  600ms   Debounce fires → triggerSearch
  600ms   Exact cache miss
  600ms   Prefix cache hit → UI shows filtered "market" results    ← INSTANT
  601ms   Client search → UI shows client + prefix merged results  ← INSTANT
  601ms   Server API calls launched (parallel)
  ~900ms  Users API resolves → appendResults (new users appear)    ← PROGRESSIVE
  ~900ms  Globalsearch resolves → appendResults (new chats appear) ← PROGRESSIVE
  ~900ms  Messages API resolves → appendResults (messages appear)  ← PROGRESSIVE
  ~900ms  All done → final merge cached, isLoading = false         ← FINAL
```
