/**
 * One search box for the whole site.
 *
 * Until now each screen searched only its own rows, so a reader who knew a
 * supplier's name or a minister's name had nowhere to type it. This searches the
 * entities the summary already holds — sections, office-holders, suppliers, support
 * recipients and topics — and navigates to the entity's own page.
 *
 * It runs entirely over already-loaded data: no index service, and it works with no
 * network. The heavy datasets are not required — supplier and recipient names come
 * from the pages that already loaded them and are passed in.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { matchesQuery } from '../lib/selectors';

export interface SearchEntry {
  id: string;
  label: string;
  /** What kind of thing this is, shown as a quiet suffix. */
  kindLabelHe: string;
  to: string;
  /** Extra text that should match, e.g. an official name or aliases. */
  keywords?: readonly string[];
}

const MAX_RESULTS = 12;

export function CommandSearch({ entries }: { entries: readonly SearchEntry[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const results = useMemo(() => {
    if (query.trim() === '') return entries.slice(0, MAX_RESULTS);
    return entries
      .filter((entry) => matchesQuery([entry.label, ...(entry.keywords ?? [])], query))
      .slice(0, MAX_RESULTS);
  }, [entries, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open, query]);

  function go(entry: SearchEntry | undefined): void {
    if (entry === undefined) return;
    setOpen(false);
    setQuery('');
    navigate(entry.to);
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="חיפוש באתר"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">חיפוש</span>
        <kbd className="num hidden rounded border border-rule bg-surface-2 px-1 text-[10px] text-ink-3 lg:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label="חיפוש באתר"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="card w-full max-w-xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-rule p-3">
              <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                className="w-full bg-transparent text-sm text-ink outline-none"
                placeholder="משרד, שר, ספק, נושא…"
                value={query}
                aria-label="חיפוש משרדים, אנשים, ספקים ונושאים"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, results.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    go(results[activeIndex]);
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setOpen(false)}
                aria-label="סגירת החיפוש"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {results.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">
                לא נמצאה התאמה. החיפוש עובר על שמות סעיפים, בעלי תפקידים, ספקים, מקבלי תמיכות
                ונושאים — לא על תוכן השורות עצמן.
              </p>
            ) : (
              <ul className="max-h-[50vh] overflow-y-auto">
                {results.map((entry, index) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-right text-sm ${
                        index === activeIndex ? 'bg-brand-soft text-ink' : 'text-ink-2'
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(entry)}
                    >
                      <span className="truncate">{entry.label}</span>
                      <span className="shrink-0 text-xs text-ink-3">{entry.kindLabelHe}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
