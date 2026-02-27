/**
 * useSearch.js
 * ─────────────────────────────────────────────────────────────
 * The public API bridge between Redux and any UI.
 *
 * What this hook does:
 *  ✓ Reads state from Redux via fine-grained selectors
 *  ✓ Dispatches actions to Redux
 *  ✓ Manages debouncing (not in Redux — timing is a UI concern)
 *  ✓ Holds runtime config (moduleApis, weights, etc.) in refs
 *  ✓ Exposes prop-getter functions for accessibility
 *  ✓ Returns everything the UI needs — zero Redux imports required in UI
 *
 * What this hook does NOT do:
 *  ✗ Render anything
 *  ✗ Touch the DOM
 *  ✗ Know about CSS or styles
 *  ✗ Contain business logic (that's in the engine + slice)
 *
 * ── Usage ────────────────────────────────────────────────────
 *
 * // Option A — use the built-in AdvancedSearch UI
 * <AdvancedSearch context="home" clientData={...} moduleApis={...} />
 *
 * // Option B — build your own UI from scratch
 * const search = useSearch({ context: 'home', clientData, moduleApis });
 * return <input {...search.getInputProps()} />;
 *
 * // Option C — use headless SearchPrimitive compound components
 * <SearchPrimitive.Root config={...}>
 *   <SearchPrimitive.Input />
 *   <SearchPrimitive.Results renderItem={...} />
 * </SearchPrimitive.Root>
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  // actions
  setQuery, setOpen, moveHighlight, setHighlightedIndex, setActiveCategory,
  setContext, addFilter, removeFilter, clearFilters,
  addToHistory, clearHistory, clearSearch, clearExpiredCache,
  // thunk
  executeSearch,
  // selectors
  selectQuery, selectParsedQuery, selectAllResults,
  selectFilteredResults, selectIsLoading, selectError,
  selectIsOpen, selectHighlightedIndex, selectActiveCategory,
  selectActiveFilters, selectContext, selectSearchHistory,
  selectCategoryCounts, selectHighlightedResult,
  selectAvailableCategories,
  // constants
  DEFAULT_MODULE_WEIGHTS,
} from '../store/searchSlice';
import { DEFAULT_SCORER_CONFIG } from '../engine/scorer';

// ─────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────

const DEBOUNCE_MS     = 600;
const MIN_SERVER_LEN  = 3;

const defaultGetFields = (item) => {
  switch (item._module) {
    case 'users':
      return [
        item.full_name,
        item.email,
        item.title,
        item.handle,
        item.description,
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
        item.sendername,
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
};

const defaultGetDedupKey = (item) => {
  if (item._module === 'users') {
    const name = item.full_name || item.name || item.title;
    if (name) return `users::name::${name.toLowerCase()}`;
  }
  return `${item._module ?? 'unknown'}::${item.id ?? item.name ?? Math.random()}`;
};

// ─────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} config
 *
 * Required:
 * @param {string}   config.context         - 'home'|'channels'|'files'|etc.
 *
 * Data sources:
 * @param {object}   [config.clientData]    - { chats: [], users: [] }
 * @param {string[]} [config.moduleApis]    - ['users', 'chats', ...]
 *
 * Customization:
 * @param {object}   [config.moduleConfig]  - Weight overrides: { users: 1.8 }
 * @param {object}   [config.scorerConfig]  - Override scorer constants
 * @param {Function} [config.getFields]     - (item) => string[]
 * @param {Function} [config.getDedupKey]   - (item) => string
 * @param {number}   [config.debounceMs]    - default 180
 * @param {number}   [config.minServerLen]  - default 3
 * @param {number}   [config.maxResults]    - cap result count
 *
 * Callbacks:
 * @param {Function} [config.onSelect]      - (item) => void
 * @param {Function} [config.onQueryChange] - (query, parsedQuery) => void
 * @param {Function} [config.onOpen]        - () => void
 * @param {Function} [config.onClose]       - () => void
 */
export function useSearch({
  context,
  clientData     = { chats: [], users: [] },
  moduleApis     = [],
  moduleConfig   = {},
  scorerConfig   = DEFAULT_SCORER_CONFIG,
  getFields      = defaultGetFields,
  getDedupKey    = defaultGetDedupKey,
  debounceMs     = DEBOUNCE_MS,
  minServerLen   = MIN_SERVER_LEN,
  maxResults,
  onSelect,
  onQueryChange,
  onOpen,
  onClose,
  loggedUser,
} = {}) {
  const dispatch = useDispatch();

  // ── Selectors (fine-grained = minimal re-renders) ──
  const query              = useSelector(selectQuery);
  const parsedQuery        = useSelector(selectParsedQuery);
  const allResults         = useSelector(selectAllResults);
  const filteredResults    = useSelector(selectFilteredResults);
  const isLoading          = useSelector(selectIsLoading);
  const error              = useSelector(selectError);
  const isOpen             = useSelector(selectIsOpen);
  const highlightedIndex   = useSelector(selectHighlightedIndex);
  const highlightedResult  = useSelector(selectHighlightedResult);
  const activeCategory     = useSelector(selectActiveCategory);
  const activeFilters      = useSelector(selectActiveFilters);
  const currentContext     = useSelector(selectContext);
  const searchHistory      = useSelector(selectSearchHistory);
  const categoryCounts     = useSelector(selectCategoryCounts);
  const availableCategories= useSelector(selectAvailableCategories);

  // ── Hold mutable config in refs (changes don't re-run effects) ──
  const configRef = useRef({});
  configRef.current = {
    clientData, moduleApis, moduleConfig, scorerConfig,
    getFields, getDedupKey, minServerLen, maxResults, loggedUser,
  };

  // ── Sync context to store on mount / context change ──
  useEffect(() => {
    if (context && context !== currentContext) {
      dispatch(setContext(context));
    }
  }, [context, currentContext, dispatch]);

  // ── Periodic cache cleanup (every 5 minutes) ──
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      dispatch(clearExpiredCache());
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(cleanupInterval);
  }, [dispatch]);

  // ── Debounce ref ──
  const debounceRef = useRef(null);

 
  const moduleWeights = useMemo(() => ({
    ...DEFAULT_MODULE_WEIGHTS,
    ...moduleConfig,
  }), [moduleConfig]);

  // ─────────────────────────────────────────────────────────────
  // CORE TRIGGER
  // Dispatches the async thunk with current config.
  // ─────────────────────────────────────────────────────────────

  const triggerSearch = useCallback((pq, category) => {
    if (pq.isEmpty) return;
    const cfg = configRef.current;
    dispatch(executeSearch({
      parsedQuery:    pq,
      context:        context ?? currentContext,
      activeCategory: category,
      clientData:     cfg.clientData,
      enabledModules: cfg.moduleApis,
      moduleWeights,
      scorerConfig:   cfg.scorerConfig,
      getFields:      cfg.getFields,
      getDedupKey:    cfg.getDedupKey,
      minServerLen:   cfg.minServerLen,
      maxResults:     cfg.maxResults,
      loggedUser:     cfg.loggedUser,
    }));
  }, [dispatch, context, currentContext, moduleWeights]);

  const handleQueryChange = useCallback((value) => {
    dispatch(setQuery(value));
   
    const pq = { ...parsedQuery, trimmed: value }; 
    onQueryChange?.(value, pq);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
     
      dispatch((_, getState) => {
        const fresh = getState().search;
        triggerSearch(fresh.parsedQuery, fresh.activeCategory);
      });
    }, debounceMs);
  }, [dispatch, parsedQuery, onQueryChange, debounceMs, activeCategory, triggerSearch]);


  const handleCategoryChange = useCallback((category) => {
    dispatch(setActiveCategory(category));
   
    triggerSearch(parsedQuery, category);
  }, [dispatch, parsedQuery, triggerSearch]);

 
  const handleAddFilter = useCallback((key, value) => {
    dispatch(addFilter({ key, value }));
    // Dispatch thunk with updated parsedQuery
    dispatch((_, getState) => {
      const fresh = getState().search;
      triggerSearch(fresh.parsedQuery, fresh.activeCategory);
    });
  }, [dispatch, triggerSearch]);

  /** Remove a filter token */
  const handleRemoveFilter = useCallback((key) => {
    dispatch(removeFilter(key));
    dispatch((_, getState) => {
      const fresh = getState().search;
      triggerSearch(fresh.parsedQuery, fresh.activeCategory);
    });
  }, [dispatch, triggerSearch]);

  /** Select a result item */
  const handleSelect = useCallback((item) => {
    if (!item) return;
    dispatch(addToHistory(item._searchQuery ?? query));
    dispatch(setOpen(false));
    onSelect?.(item);
  }, [dispatch, query, onSelect]);

  /** Select the currently highlighted result */
  const handleSelectHighlighted = useCallback(() => {
    if (highlightedResult) handleSelect(highlightedResult);
    else if (query.trim()) dispatch(addToHistory(query));
  }, [highlightedResult, handleSelect, query, dispatch]);

  /** Open dropdown */
  const handleOpen = useCallback(() => {
    dispatch(setOpen(true));
    onOpen?.();
  }, [dispatch, onOpen]);

  /** Close dropdown */
  const handleClose = useCallback(() => {
    dispatch(setOpen(false));
    onClose?.();
  }, [dispatch, onClose]);

  /** Clear everything */
  const handleClear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dispatch(clearSearch());
  }, [dispatch]);

  // ─────────────────────────────────────────────────────────────
  // PROP GETTERS
  // Spread these onto native elements for accessibility + interaction.
  // UI components never need to import from Redux.
  // ─────────────────────────────────────────────────────────────

  /**
   * Props for the <input> element.
   * @param {object} [overrides] - Override or extend any prop
   */
  const getInputProps = useCallback((overrides = {}) => ({
    type:            'text',
    role:            'combobox',
    autoComplete:    'off',
    spellCheck:      false,
    'aria-expanded': isOpen,
    'aria-haspopup': 'listbox',
    'aria-autocomplete': 'list',
    value:           query,
    onChange:        (e) => handleQueryChange(e.target.value),
    onFocus:         handleOpen,
    onKeyDown:       (e) => {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); dispatch(moveHighlight(+1)); break;
        case 'ArrowUp':   e.preventDefault(); dispatch(moveHighlight(-1)); break;
        case 'Enter':     e.preventDefault(); handleSelectHighlighted();    break;
        case 'Escape':    e.preventDefault(); handleClose();                break;
        default: break;
      }
      overrides.onKeyDown?.(e);
    },
    ...overrides,
  }), [query, isOpen, handleQueryChange, handleOpen, handleClose, handleSelectHighlighted, dispatch]);

  /**
   * Props for the outer container div.
   * Handles click-outside to close.
   */
  const getContainerProps = useCallback((overrides = {}) => ({
    role: 'search',
    ...overrides,
  }), []);

  /**
   * Props for each result item element.
   * @param {object} item
   * @param {number} index
   */
  const getResultProps = useCallback((item, index, overrides = {}) => ({
    role:          'option',
    'aria-selected': highlightedIndex === index,
    tabIndex:      -1,
    onClick:       () => handleSelect(item),
    onMouseEnter:  () => dispatch(setHighlightedIndex(index)),
    ...overrides,
  }), [highlightedIndex, handleSelect, dispatch]);

  // ─────────────────────────────────────────────────────────────
  // RETURN
  // Everything the UI needs. No Redux knowledge required.
  // ─────────────────────────────────────────────────────────────

  return {
    // ── State ──────────────────────────────────────────────
    query,
    parsedQuery,
    allResults,
    filteredResults,
    isLoading,
    error,
    isOpen,
    highlightedIndex,
    highlightedResult,
    activeCategory,
    activeFilters,
    context: currentContext,
    searchHistory,
    categoryCounts,
    availableCategories,

    // ── Actions ────────────────────────────────────────────
    setQuery:          handleQueryChange,
    setCategory:       handleCategoryChange,
    addFilter:         handleAddFilter,
    removeFilter:      handleRemoveFilter,
    clearFilters:      () => { dispatch(clearFilters()); triggerSearch(parsedQuery, activeCategory); },
    select:            handleSelect,
    open:              handleOpen,
    close:             handleClose,
    clear:             handleClear,
    clearHistory:      () => dispatch(clearHistory()),
    moveHighlight:     (dir) => dispatch(moveHighlight(dir)),
    selectHighlighted: handleSelectHighlighted,

    // ── Prop getters ───────────────────────────────────────
    getInputProps,
    getContainerProps,
    getResultProps,
  };
}