import { NavLink, Link } from 'react-router-dom';
import { useState } from 'react';
import { Github, Landmark, Menu, X } from 'lucide-react';
import { REPO_URL, SITE_SUBTITLE, SITE_TITLE, DATA_DIR_URL } from '../lib/site';
import { useDataState } from '../data/DataProvider';
import { formatDate } from '../lib/format';

const NAV = [
  { to: '/', label: 'בית' },
  { to: '/budget', label: 'תקציב' },
  { to: '/analysis', label: 'ניתוח' },
  { to: '/activity', label: 'פעילות' },
  { to: '/sources', label: 'מקורות' },
  { to: '/methodology', label: 'מתודולוגיה ומגבלות' },
  { to: '/about', label: 'אודות ואיכות נתונים' },
] as const;

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'rounded-md px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');
}

export function Layout({ children }: { children: React.ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const state = useDataState();
  const version = state.status === 'ready' ? state.data.dataVersion : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-3" aria-label={`${SITE_TITLE} — לדף הבית`}>
            <Landmark className="h-7 w-7 text-brand-700" aria-hidden="true" />
            <span>
              <span className="block text-lg font-semibold leading-tight">{SITE_TITLE}</span>
              <span className="block text-xs text-slate-500">{SITE_SUBTITLE}</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="ניווט ראשי">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass} end={item.to === '/'}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            className="btn lg:hidden"
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

        {menuOpen && (
          <nav
            id="mobile-nav"
            className="border-t border-slate-200 bg-white px-4 py-2 lg:hidden"
            aria-label="ניווט ראשי (מובייל)"
          >
            <ul className="flex flex-col gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={navClass}
                    end={item.to === '/'}
                    onClick={() => setMenuOpen(false)}
                  >
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

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-600">
          <p className="mb-2">
            אתר זה אינו מקור רשמי ואינו מחליף את המקורות המקוריים. כל נתון מוצג עם קישור למקור שממנו
            נאסף, או עם ציון מפורש שהנתון חסר.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {version !== null && (
              <span className="num">
                גרסת נתונים {version.version} · עודכן {formatDate(version.builtAt.slice(0, 10))}
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
