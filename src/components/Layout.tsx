/**
 * The shell: four tracks, a search box, a theme switch, and the meta links in the
 * footer where they belong.
 *
 * The navigation used to be nine flat items that mixed content ("תקציב", "יומנים")
 * with meta ("מתודולוגיה", "מקורות", "אודות"), in labels that assumed the reader
 * knows how government works — nothing on the screen distinguished "ניתוח" from
 * "ממצאים" from "פעילות". The tracks below are phrased as the questions a reader
 * actually arrives with, and every screen keeps a link to how its figures were
 * collected.
 */
import { NavLink, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Github, Landmark, Menu, Moon, Sun, X } from 'lucide-react';
import { REPO_URL, SITE_SUBTITLE, SITE_TITLE, DATA_DIR_URL } from '../lib/site';
import { useSummaryState } from '../data/DataProvider';
import { formatDate } from '../lib/format';
import { CommandSearch, type SearchEntry } from './CommandSearch';

/** The four tracks, in the reader's words rather than the pipeline's. */
const NAV = [
  { to: '/budget', label: 'לאן הלך הכסף' },
  { to: '/diaries', label: 'במה עסקו' },
  { to: '/findings', label: 'מה מצאנו' },
  { to: '/scorecards', label: 'מי שקוף יותר' },
] as const;

/** Secondary screens: reachable, but not competing with the tracks. */
const META_NAV = [
  { to: '/activity', label: 'פעילות פומבית' },
  { to: '/analysis', label: 'ניתוח מעמיק' },
  { to: '/sources', label: 'מקורות' },
  { to: '/how-to-read', label: 'איך לקרוא את האתר' },
  { to: '/methodology', label: 'מתודולוגיה ומגבלות' },
  { to: '/corrections', label: 'יומן תיקונים' },
  { to: '/about', label: 'אודות ואיכות נתונים' },
] as const;

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'rounded-md px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-brand text-brand-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  ].join(' ');
}

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'gov-map-theme';

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      applyTheme(stored);
    }
  }, []);

  function choose(next: Theme): void {
    setTheme(next);
    applyTheme(next);
    if (next === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  }

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => choose(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
      title={isDark ? 'מצב בהיר' : 'מצב כהה'}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

export function Layout({ children }: { children: React.ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const state = useSummaryState();
  const summary = state.status === 'ready' ? state.data : null;

  /**
   * Search entries come from the summary, so the box works on first paint without
   * pulling the corpus.
   */
  const searchEntries = useMemo<SearchEntry[]>(() => {
    if (summary === null) return [];
    const sections = summary.ministries.map((m) => ({
      id: `ministry-${m.id}`,
      label: m.displayName,
      kindLabelHe: m.sectionKind === 'ministry' ? 'משרד' : 'סעיף תקציב',
      to: `/ministry/${m.id}`,
      keywords: [m.officialName, m.id],
    }));
    const screens = [...NAV, ...META_NAV].map((item) => ({
      id: `screen-${item.to}`,
      label: item.label,
      kindLabelHe: 'מסך',
      to: item.to,
    }));
    return [...sections, ...screens];
  }, [summary]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-3" aria-label={`${SITE_TITLE} — לדף הבית`}>
            <Landmark className="h-7 w-7 shrink-0 text-brand" aria-hidden="true" />
            <span>
              <span className="block text-lg font-semibold leading-tight">{SITE_TITLE}</span>
              <span className="block text-xs text-ink-3">{SITE_SUBTITLE}</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="ניווט ראשי">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <CommandSearch entries={searchEntries} />
            <ThemeToggle />
            <button
              type="button"
              className="btn btn-sm lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
            >
              {menuOpen ? (
                <X className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Menu className="h-4 w-4" aria-hidden="true" />
              )}
              תפריט
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            className="border-t border-rule bg-surface px-4 py-2 lg:hidden"
            aria-label="ניווט ראשי (מובייל)"
          >
            <ul className="flex flex-col gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={navClass} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <p className="mt-3 px-3 text-xs font-medium text-ink-3">מסכים נוספים</p>
            <ul className="mt-1 flex flex-col gap-1">
              {META_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={navClass} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-ink-2">
          <nav aria-label="ניווט משני" className="mb-4">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {META_NAV.map((item) => (
                <li key={item.to}>
                  <Link className="link" to={item.to}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mb-2 max-w-3xl">
            אתר זה אינו מקור רשמי ואינו מחליף את המקורות המקוריים. כל נתון מוצג עם קישור למקור שממנו
            נאסף, או עם ציון מפורש שהנתון חסר.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {summary !== null && (
              <span className="num">
                גרסת נתונים {summary.dataVersion.version} · עודכן{' '}
                {formatDate(summary.dataVersion.builtAt.slice(0, 10))}
              </span>
            )}
            <a className="link" href={DATA_DIR_URL} target="_blank" rel="noopener noreferrer">
              קובצי הנתונים
            </a>
            <a
              className="link inline-flex items-center gap-1"
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              קוד המקור ב-GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
