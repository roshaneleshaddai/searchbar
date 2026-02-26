/**
 * SearchPrimitive.jsx
 * ─────────────────────────────────────────────────────────────
 * Headless compound components. Zero styles. Zero opinions.
 * Full accessibility (ARIA). Works with any CSS approach.
 *
 * These components:
 *  ✓ Call useSearch() internally
 *  ✓ Handle all ARIA/a11y attributes
 *  ✓ Handle all keyboard navigation
 *  ✓ Handle click-outside to close
 *  ✓ Expose render props for full UI control
 *  ✓ Accept any `as` prop to change the rendered element
 *  ✗ Never render a single style
 *  ✗ Never import CSS
 *
 * ── Usage ────────────────────────────────────────────────────
 *
 * <SearchPrimitive.Root config={{ context: 'home', ... }}>
 *   <SearchPrimitive.Input
 *     as="input"
 *     className="my-input"
 *     placeholder="Search..."
 *   />
 *   <SearchPrimitive.Panel>
 *     <SearchPrimitive.CategoryList>
 *       {(cat, isActive, count) => (
 *         <button className={isActive ? 'tab active' : 'tab'}>
 *           {cat} {count > 0 && <span>{count}</span>}
 *         </button>
 *       )}
 *     </SearchPrimitive.CategoryList>
 *
 *     <SearchPrimitive.ResultList>
 *       {(item, index, isHighlighted, itemProps) => (
 *         <div {...itemProps} className={isHighlighted ? 'result active' : 'result'}>
 *           {item.name}
 *         </div>
 *       )}
 *     </SearchPrimitive.ResultList>
 *
 *     <SearchPrimitive.Empty>
 *       <p>No results found.</p>
 *     </SearchPrimitive.Empty>
 *
 *     <SearchPrimitive.Loading>
 *       <Spinner />
 *     </SearchPrimitive.Loading>
 *   </SearchPrimitive.Panel>
 * </SearchPrimitive.Root>
 */

import {
  createContext, useContext, useEffect, useRef,forwardRef,
} from 'react';
import { Provider } from 'react-redux';
import { store } from '../store/store';
import { useSearch } from '../hooks/useSearch';

// ─────────────────────────────────────────────────────────────
// CONTEXT
// Passes search state + actions through the compound tree.
// ─────────────────────────────────────────────────────────────

const SearchContext = createContext(null);

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used inside <SearchPrimitive.Root>');
  return ctx;
}

// ─────────────────────────────────────────────────────────────
// ROOT
// Provides Redux store + search context to all children.
// Handles click-outside.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object} props.config       - useSearch() config object
 * @param {React.ReactNode} props.children
 * @param {string|Component} [props.as='div']
 * @param {object} [props.reduxStore] - Custom store (default: built-in store)
 */
function Root({ config = {}, children, as: Tag = 'div', reduxStore = store, ...rest }) {
  const containerRef = useRef(null);

  return (
    <Provider store={reduxStore}>
      <RootInner config={config} containerRef={containerRef} Tag={Tag} rest={rest}>
        {children}
      </RootInner>
    </Provider>
  );
}

function RootInner({ config, children, containerRef, Tag, rest }) {
  const search = useSearch(config);

  // Click-outside handler
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        search.close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [search.close, containerRef]);

  return (
    <SearchContext.Provider value={search}>
      <Tag ref={containerRef} {...search.getContainerProps(rest)}>
        {children}
      </Tag>
    </SearchContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// INPUT
// Renders the search input. Spreads all interaction props.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='input']
 * All other props forwarded to the element (className, placeholder, style, etc.)
 */
const Input = forwardRef(function SearchInput({ as: Tag = 'input', ...props }, ref) {
  const search = useSearchContext();
  return <Tag ref={ref} {...search.getInputProps(props)} />;
});

// ─────────────────────────────────────────────────────────────
// CLEAR BUTTON
// Renders only when there's a query to clear.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='button']
 * @param {React.ReactNode} [props.children]    - Custom icon/label
 */
function ClearButton({ as: Tag = 'button', children = '×', ...props }) {
  const { query, clear } = useSearchContext();
  if (!query) return null;
  return (
    <Tag
      type="button"
      aria-label="Clear search"
      onClick={clear}
      {...props}
    >
      {children}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────
// LOADING INDICATOR
// Renders children only while loading.
// ─────────────────────────────────────────────────────────────

function Loading({ children }) {
  const { isLoading } = useSearchContext();
  return isLoading ? <>{children}</> : null;
}

// ─────────────────────────────────────────────────────────────
// PANEL
// The dropdown/results container. Renders only when isOpen.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='div']
 * @param {boolean} [props.forceOpen]   - Always render (for fullPage mode)
 */
function Panel({ as: Tag = 'div', forceOpen = false, children, ...props }) {
  const { isOpen, query } = useSearchContext();
  if (!isOpen && !forceOpen) return null;
  return (
    <Tag role="listbox" aria-label="Search results" {...props}>
      {children}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────
// CATEGORY LIST
// Renders category tabs. Uses render prop pattern.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='div']
 * @param {Function} props.children
 *   (category: string, isActive: boolean, count: number, onClick: fn) => ReactNode
 */
function CategoryList({ as: Tag = 'div', children, ...props }) {
  const { availableCategories, activeCategory, categoryCounts, setCategory } = useSearchContext();

  if (availableCategories.length <= 1) return null;

  return (
    <Tag role="tablist" {...props}>
      {availableCategories.map((cat) =>
        children(
          cat,
          cat === activeCategory,
          categoryCounts[cat] ?? 0,
          () => setCategory(cat),
        )
      )}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────
// RESULT LIST
// Renders ranked results. Uses render prop pattern.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='div']
 * @param {number} [props.limit]   - Max results to show
 * @param {Function} props.children
 *   (item: object, index: number, isHighlighted: boolean, itemProps: object) => ReactNode
 */
function ResultList({ as: Tag = 'div', limit, children, ...props }) {
  const { filteredResults, highlightedIndex, getResultProps } = useSearchContext();
  const items = limit ? filteredResults.slice(0, limit) : filteredResults;
  // console.log('Rendering ResultList with items:', items);
  if (!items.length) return null;

  return (
    <Tag {...props}>
      {items.map((item, idx) =>
        children(
          item,
          idx,
          idx === highlightedIndex,
          getResultProps(item, idx),
        )
      )}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────
// EMPTY STATE
// Renders children when there's a query but no results.
// ─────────────────────────────────────────────────────────────

/**
 * @param {Function|ReactNode} props.children
 *   If function: (query: string) => ReactNode
 */
function Empty({ children }) {
  const { query, filteredResults, isLoading } = useSearchContext();
  if (!query || filteredResults.length > 0 || isLoading) return null;
  return <>{typeof children === 'function' ? children(query) : children}</>;
}

// ─────────────────────────────────────────────────────────────
// HISTORY LIST
// Renders search history when query is empty.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string|Component} [props.as='div']
 * @param {number} [props.limit=5]
 * @param {Function} props.children
 *   (entry: string, onSelect: fn) => ReactNode
 */
function HistoryList({ as: Tag = 'div', limit = 5, children, ...props }) {
  const { query, searchHistory, setQuery } = useSearchContext();
  if (query || !searchHistory.length) return null;

  return (
    <Tag {...props}>
      {searchHistory.slice(0, limit).map((entry) =>
        children(entry, () => setQuery(entry))
      )}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────
// FILTER LIST
// Renders active filter tokens as removable chips.
// ─────────────────────────────────────────────────────────────

/**
 * @param {Function} props.children
 *   (key: string, value: string, onRemove: fn) => ReactNode
 */
function FilterList({ children }) {
  const { activeFilters, removeFilter } = useSearchContext();
  const entries = Object.entries(activeFilters);
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([key, value]) =>
        children(key, value, () => removeFilter(key))
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// RESULT COUNT
// ─────────────────────────────────────────────────────────────

/**
 * @param {Function} props.children
 *   (count: number, filteredCount: number) => ReactNode
 */
function ResultCount({ children }) {
  const { allResults, filteredResults } = useSearchContext();
  return <>{children(allResults.length, filteredResults.length)}</>;
}

// ─────────────────────────────────────────────────────────────
// EXPORT: SearchPrimitive namespace
// ─────────────────────────────────────────────────────────────

export const SearchPrimitive = {
  Root,
  Input,
  ClearButton,
  Loading,
  Panel,
  CategoryList,
  ResultList,
  Empty,
  HistoryList,
  FilterList,
  ResultCount,
};

export default SearchPrimitive;