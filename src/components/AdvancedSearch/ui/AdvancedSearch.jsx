/**
 * AdvancedSearch.jsx
 * ─────────────────────────────────────────────────────────────
 * Opinionated, production-ready UI built ENTIRELY on top of:
 *   SearchPrimitive.* (headless) → useSearch() → Redux → Engine
 *
 * This file contains ONLY UI concerns:
 *  ✓ Styling / layout
 *  ✓ Icon rendering
 *  ✓ Animation / transitions
 *  ✓ Slot composition (what goes where)
 *
 * This file contains ZERO:
 *  ✗ Direct Redux imports
 *  ✗ useSelector / useDispatch
 *  ✗ Business logic
 *  ✗ API calls
 *  ✗ Scoring logic
 *
 * Developers can build their own UI using the same primitives.
 */

import { useState } from 'react';
import { SearchPrimitive } from '../primitives/SearchPrimitive';
import { FILTER_TOKENS } from '../engine/queryParser';

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS (one place to change the whole look)
// ─────────────────────────────────────────────────────────────

const T = {
  // Colors
  bg:          '#e2e2f0',
  surface:     '#f3f3f6',
  surfaceHigh: '#f2f2f2',
  border:      '#d1d1e0',
  borderHover: '#3d3d6b',
  accent:      '#7c5cfc',
  accentGlow:  'rgba(124,92,252,0.15)',
  accentSoft:  'rgba(124,92,252,0.12)',
  text:        '#1a1a2e',
  textSub:     '#8888aa',
  textDim:     '#555577',
  success:     '#22d3a5',
  warn:        '#f59e42',
  info:        '#38bdf8',
  danger:      '#f87171',

  // Radii
  rSm:  '6px',
  rMd:  '10px',
  rLg:  '14px',
  rXl:  '18px',
  rFull:'999px',

  // Shadows
  shadowMd:  '0 4px 20px rgba(0,0,0,0.4)',
  shadowLg:  '0 8px 40px rgba(0,0,0,0.5)',
  glowAccent:'0 0 0 1px rgba(124,92,252,0.4), 0 0 20px rgba(124,92,252,0.1)',

  // Font
  font: "'Outfit', 'DM Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

// ─────────────────────────────────────────────────────────────
// MODULE PALETTE
// ─────────────────────────────────────────────────────────────

const MODULE_PALETTE = {
  users:       { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',  label: 'User' },
  channels:    { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',   label: 'Channel' },
  chats:       { color: '#34d399', bg: 'rgba(52,211,153,0.1)',   label: 'Chat' },
  messages:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',   label: 'Message' },
  bots:        { color: '#c084fc', bg: 'rgba(192,132,252,0.1)',  label: 'Bot' },
  files:       { color: '#f87171', bg: 'rgba(248,113,113,0.1)',  label: 'File' },
  threads:     { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',   label: 'Thread' },
  department:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', label: 'Dept' },
  settings:    { color: '#9ca3af', bg: 'rgba(156,163,175,0.1)', label: 'Setting' },
  apps:        { color: '#fb923c', bg: 'rgba(251,146,60,0.1)',   label: 'App' },
  connections: { color: '#2dd4bf', bg: 'rgba(45,212,191,0.1)',  label: 'Connection' },
  default:     { color: '#8888aa', bg: 'rgba(136,136,170,0.1)', label: 'Result' },
};

const palette = (mod) => MODULE_PALETTE[mod] || MODULE_PALETTE.default;

// ─────────────────────────────────────────────────────────────
// INLINE SVG ICONS (zero external deps)
// ─────────────────────────────────────────────────────────────

const Icons = {
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  Close: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Filter: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
    </svg>
  ),
  Clock: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Spinner: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ animation: 'spin 0.75s linear infinite', display: 'block' }}>
      <path d="M21 12a9 9 0 1 1-18 0" />
    </svg>
  ),
  User: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Hash: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
      <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Bot: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/>
      <circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
      <line x1="8" y1="15" x2="8" y2="17"/><line x1="16" y1="15" x2="16" y2="17"/>
    </svg>
  ),
};

const MODULE_ICON = {
  users: Icons.User,
  channels: Icons.Hash,
  chats: Icons.Hash,
  bots: Icons.Bot,
  default: Icons.Search,
};

const ModuleIcon = ({ module: mod }) => {
  const Ico = MODULE_ICON[mod] || MODULE_ICON.default;
  return <Ico />;
};

// ─────────────────────────────────────────────────────────────
// MATCH BADGE
// ─────────────────────────────────────────────────────────────

const MATCH_BADGE = {
  exact:      { label: 'Exact',  color: T.success },
  startsWith: { label: 'Starts', color: T.info },
  middle:     { label: 'In',     color: T.warn },
};

function MatchBadge({ type }) {
  const b = MATCH_BADGE[type];
  if (!b) return null;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 5px', borderRadius: T.rFull,
      color: b.color,
      background: b.color + '22',
      border: `1px solid ${b.color}44`,
      textTransform: 'uppercase',
      fontFamily: T.mono,
    }}>
      {b.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// HIGHLIGHT
// ─────────────────────────────────────────────────────────────

function Highlight({ text = '', query = '' }) {
  if (!text || !query) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: 'rgba(124,92,252,0.35)', color: '#d4bbff', borderRadius: 3, padding: '0 2px' }}>{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// FILTER PANEL (internal, uses context via FilterList primitive)
// ─────────────────────────────────────────────────────────────

function FilterPanel() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');

  return (
    <SearchPrimitive.Root>
      {/* We need context here — wrap in a render-prop getter */}
    </SearchPrimitive.Root>
  );
}

// Simpler: FilterBar uses the primitives directly
function FilterBar() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selKey, setSelKey] = useState('');
  const [selVal, setSelVal] = useState('');

  // Access context directly
  const { addFilter } = require('../hooks/useSearch').useSearch
    ? {} // handled below
    : {};

  // FilterBar is a pure UI fragment — it renders via FilterList primitive
  // and accesses add/remove via context (provided by Root)
  return null; // placeholder — actual FilterBar is wired inside AdvancedSearch below
}

// ─────────────────────────────────────────────────────────────
// RESULT ITEM (UI shell, data comes from render prop)
// ─────────────────────────────────────────────────────────────

function ResultItem({ item, index, isHighlighted, itemProps, query }) {
  const p = palette(item._module);
  const name = item.full_name || item.title || item.handle ||item.message||'';
  const sub  = item.email || item.description || '';

  return (
    <div
      {...itemProps}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', cursor: 'pointer',
        borderBottom: `1px solid ${T.border}`,
        background: isHighlighted ? T.surfaceHigh : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Avatar / module icon */}
      {item.avatar
        ? <img src={item.avatar} alt="" style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} />
        : (
          <div style={{
            width: 30, height: 30, borderRadius: T.rSm, flexShrink: 0,
            background: p.bg, border: `1px solid ${p.color}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: p.color,
          }}>
            <ModuleIcon module={item._module} />
          </div>
        )
      }

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 13, color: T.text }}>
            <Highlight text={name} query={query} />
          </span>
          <MatchBadge type={item._matchType} />
        </div>
        {sub && (
          <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Highlight text={sub} query={query} />
          </div>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: p.color,
          background: p.bg, borderRadius: T.rFull,
          padding: '2px 7px', textTransform: 'capitalize',
        }}>
          {p.label}
        </span>
        {item._source === 'client' && (
          <span style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono }}>local</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FILTER INPUT WIDGET (self-contained, uses SearchPrimitive context)
// ─────────────────────────────────────────────────────────────

function FilterInputWidget({ addFilter }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');

  const commit = () => {
    if (key && val) { addFilter(key, val); setKey(''); setVal(''); setOpen(false); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: T.rSm, cursor: 'pointer',
          background: open ? T.accentSoft : 'transparent',
          border: `1px solid ${open ? T.accent : T.border}`,
          color: open ? T.accent : T.textSub, fontSize: 12,
        }}
      >
        <Icons.Filter /> Filters
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: T.rMd, padding: 10, display: 'flex', gap: 6,
          boxShadow: T.shadowLg, minWidth: 280,
        }}>
          <select
            value={key}
            onChange={e => setKey(e.target.value)}
            style={{
              background: T.bg, color: T.text, border: `1px solid ${T.border}`,
              borderRadius: T.rSm, padding: '4px 6px', fontSize: 12, flex: '0 0 auto',
            }}
          >
            <option value="">Token...</option>
            {FILTER_TOKENS.map(t => <option key={t} value={t}>{t}:</option>)}
          </select>
          <input
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commit()}
            placeholder={key === 'from' || key === 'to' ? '@user' : key === 'in' ? '#channel' : 'value'}
            style={{
              flex: 1, background: T.bg, color: T.text,
              border: `1px solid ${T.border}`, borderRadius: T.rSm,
              padding: '4px 8px', fontSize: 12, outline: 'none',
            }}
          />
          <button
            onClick={commit}
            style={{
              background: T.accent, color: '#fff', border: 'none',
              borderRadius: T.rSm, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {string}   props.context          - 'home' | 'channels' | 'files' | ...
 * @param {object}   props.clientData       - { chats: [], users: [] }
 * @param {object}   [props.moduleApis]     - { module: async fn }
 * @param {object}   [props.moduleConfig]   - weight overrides
 * @param {object}   [props.scorerConfig]   - scorer constant overrides
 * @param {Function} [props.onSelect]       - (item) => void
 * @param {boolean}  [props.fullPage]       - render as full-page (no dropdown)
 * @param {string}   [props.placeholder]
 * @param {object}   [props.reduxStore]     - custom store instance
 */
export default function AdvancedSearch({
  context = 'home',
  clientData,
  moduleApis,
  moduleConfig,
  scorerConfig,
  onSelect,
  fullPage = false,
  placeholder = 'Search...',
  reduxStore,
  loggedUser,
}) {
  const searchConfig = {
    context, clientData, moduleApis, moduleConfig, scorerConfig,
    onSelect, debounceMs:600, minServerLen: 3, loggedUser,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        [data-search-panel] { animation: fadeSlide 0.15s ease; }
      `}</style>

      <SearchPrimitive.Root
        config={searchConfig}
        reduxStore={reduxStore}
        style={{
          position: 'relative',
          width: '780px', maxWidth: '100%',
          fontFamily: T.font,
          fontSize: 14,
          color: T.text,
        }}
      >
        {/* ── Search bar row ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: T.surface,
          border: `1.5px solid ${T.border}`,
          borderRadius: T.rLg,
          padding: '0 14px',
          height: 46,
          boxShadow: T.shadowMd,
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = T.accent;
            e.currentTarget.style.boxShadow = T.glowAccent;
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              e.currentTarget.style.borderColor = T.border;
              e.currentTarget.style.boxShadow = T.shadowMd;
            }
          }}
        >
          <span style={{ color: T.textDim, display: 'flex', flexShrink: 0 }}><Icons.Search /></span>

          <SearchPrimitive.Input
            placeholder={placeholder}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              outline: 'none', fontSize: 14, color: T.text,
              fontFamily: T.font, minWidth: 0,
              '::placeholder': { color: T.textDim },
            }}
          />

          <SearchPrimitive.Loading>
            <span style={{ color: T.accent, display: 'flex', flexShrink: 0 }}><Icons.Spinner /></span>
          </SearchPrimitive.Loading>

          <SearchPrimitive.ClearButton style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.textDim, display: 'flex', padding: 4, borderRadius: T.rSm,
          }}>
            <Icons.Close size={12} />
          </SearchPrimitive.ClearButton>
        </div>

        {/* ── Filter bar row (active tokens + add filter) ── */}
        <SearchPrimitive.FilterList>
          {(key, value, onRemove) => (
            <div key={key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: T.accentSoft, border: `1px solid ${T.accent}44`,
              borderRadius: T.rFull, padding: '3px 8px 3px 10px',
              fontSize: 12, color: T.accent, margin: '6px 4px 0 0',
            }}>
              <span style={{ color: T.textSub, fontFamily: T.mono }}>{key}:</span>
              <span>{value}</span>
              <button onClick={onRemove} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: T.accent, display: 'flex', padding: 1,
              }}>
                <Icons.Close size={10} />
              </button>
            </div>
          )}
        </SearchPrimitive.FilterList>

        {/* ── Results panel ── */}
        <SearchPrimitive.Panel
          forceOpen={fullPage}
          data-search-panel
          style={{
            position: fullPage ? 'static' : 'absolute',
            top: fullPage ? 'auto' : 'calc(100% + 8px)',
            left: 0, right: 0,
            background: T.surface,
            border: `1.5px solid ${T.border}`,
            borderRadius: T.rLg,
            boxShadow: fullPage ? 'none' : T.shadowLg,
            zIndex: 9999,
            overflow: 'hidden',
            maxHeight: fullPage ? 'none' : 480,
            overflowY: 'auto',
            marginTop: fullPage ? 8 : 0,
          }}
        >
          {/* Category tabs */}
          <SearchPrimitive.CategoryList style={{
            display: 'flex', gap: 2, padding: '8px 8px 0',
            borderBottom: `1px solid ${T.border}`,
            overflowX: 'auto',
          }}>
            {(cat, isActive, count, onClick) => (
              <button
                key={cat}
                onClick={onClick}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', fontSize: 11.5, fontWeight: isActive ? 600 : 400,
                  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  borderRadius: `${T.rSm} ${T.rSm} 0 0`,
                  textTransform: 'capitalize',
                  background: isActive ? T.accentSoft : 'transparent',
                  color: isActive ? T.accent : T.textSub,
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {cat.replace(/_/g, ' ')}
                {count > 0 && (
                  <span style={{
                    background: isActive ? T.accent : T.border,
                    color: isActive ? '#fff' : T.textSub,
                    borderRadius: T.rFull, padding: '1px 6px',
                    fontSize: 10, fontWeight: 700, minWidth: 16, textAlign: 'center',
                  }}>{count}</span>
                )}
              </button>
            )}
          </SearchPrimitive.CategoryList>

          {/* Recent searches (shown when query is empty) */}
          <SearchPrimitive.HistoryList style={{ padding: '8px 0' }}>
            {(entry, onSelect) => (
              <div
                key={entry}
                onClick={onSelect}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 14px', cursor: 'pointer', color: T.textSub,
                  fontSize: 13,
                }}
              >
                <span style={{ color: T.textDim }}><Icons.Clock /></span>
                {entry}
              </div>
            )}
          </SearchPrimitive.HistoryList>

          {/* Results */}
          <SearchPrimitive.ResultList limit={fullPage ? 50 : 8}>
            {(item, idx, isHighlighted, itemProps) => (
              <ResultItem
                key={`${item._module}-${item.id || idx}`}
                item={item}
                index={idx}
                isHighlighted={isHighlighted}
                itemProps={itemProps}
                query={item._searchQuery || ''}
              />
            )}
          </SearchPrimitive.ResultList>

          {/* Empty state */}
          <SearchPrimitive.Empty>
            {(query) => (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '36px 16px', gap: 8,
              }}>
                <span style={{ color: T.textDim, fontSize: 28 }}>⊘</span>
                <p style={{ margin: 0, fontSize: 14, color: T.textSub }}>
                  No results for <strong style={{ color: T.text }}>"{query}"</strong>
                </p>
                <p style={{ margin: 0, fontSize: 12, color: T.textDim }}>
                  Try different keywords or adjust your filters
                </p>
              </div>
            )}
          </SearchPrimitive.Empty>

          {/* Result count footer */}
          <SearchPrimitive.ResultCount>
            {(total, filtered) => total > 0 && (
              <div style={{
                padding: '8px 14px', borderTop: `1px solid ${T.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: T.textDim }}>
                  {filtered} result{filtered !== 1 ? 's' : ''}
                </span>
                {!fullPage && total > 8 && (
                  <span style={{ fontSize: 12, color: T.accent, cursor: 'pointer' }}>
                    {total - 8} more →
                  </span>
                )}
              </div>
            )}
          </SearchPrimitive.ResultCount>
        </SearchPrimitive.Panel>
      </SearchPrimitive.Root>
    </>
  );
}