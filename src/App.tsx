/**
 * Routing, and which loading tier each screen needs.
 *
 * HashRouter is used deliberately: GitHub Pages serves static files with no
 * rewrite rules, so a path-based router would 404 on a deep link or a refresh.
 * Hash routes (`/#/ministry/transport`) work from any static host, including a
 * project sub-path, with no server configuration.
 *
 * Two wrappers decide what a screen waits for. `WithSummary` renders from
 * site-summary.json — tens of kilobytes — and covers the screens a reader lands on.
 * `WithData` triggers the 12MB corpus and shows a skeleton until it arrives; only
 * screens that read the underlying rows use it, so opening the site no longer parses
 * the whole dataset.
 */
import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DataProvider, useDataState, useSummaryState } from './data/DataProvider';
import { Layout } from './components/Layout';
import { ErrorState, LoadingState, SkeletonScreen } from './components/ui';
import type { Dataset } from './types/domain';
import type { SiteSummary } from './types/summary';
import { NotFoundPage } from './pages/NotFoundPage';

// Pages are split per route so the charting library only reaches readers who open
// a screen that actually draws a chart, keeping the first load small.
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const MinistryPage = lazy(() =>
  import('./pages/MinistryPage').then((m) => ({ default: m.MinistryPage })),
);
const ActivityPage = lazy(() =>
  import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })),
);
const BudgetPage = lazy(() =>
  import('./pages/BudgetPage').then((m) => ({ default: m.BudgetPage })),
);
const SourcesPage = lazy(() =>
  import('./pages/SourcesPage').then((m) => ({ default: m.SourcesPage })),
);
const AnalysisPage = lazy(() =>
  import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })),
);
const FindingsPage = lazy(() =>
  import('./pages/FindingsPage').then((m) => ({ default: m.FindingsPage })),
);
const DiariesPage = lazy(() =>
  import('./pages/DiariesPage').then((m) => ({ default: m.DiariesPage })),
);
const MethodologyPage = lazy(() =>
  import('./pages/MethodologyPage').then((m) => ({ default: m.MethodologyPage })),
);
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const HowToReadPage = lazy(() =>
  import('./pages/HowToReadPage').then((m) => ({ default: m.HowToReadPage })),
);
const ScorecardsPage = lazy(() =>
  import('./pages/ScorecardsPage').then((m) => ({ default: m.ScorecardsPage })),
);
const PersonPage = lazy(() =>
  import('./pages/PersonPage').then((m) => ({ default: m.PersonPage })),
);
const SupplierPage = lazy(() =>
  import('./pages/SupplierPage').then((m) => ({ default: m.SupplierPage })),
);
const CorrectionsPage = lazy(() =>
  import('./pages/CorrectionsPage').then((m) => ({ default: m.CorrectionsPage })),
);

/** Renders from the small summary file. */
function WithSummary({ render }: { render: (summary: SiteSummary) => JSX.Element }): JSX.Element {
  const state = useSummaryState();
  if (state.status === 'loading') return <SkeletonScreen />;
  if (state.status === 'error') return <ErrorState message={state.message} />;
  return render(state.data);
}

/** Requests the full corpus, and shows a shaped placeholder until it lands. */
function WithData({ render }: { render: (data: Dataset) => JSX.Element }): JSX.Element {
  const state = useDataState();
  if (state.status === 'loading') return <SkeletonScreen label="טוען את מאגר הנתונים המלא…" />;
  if (state.status === 'error') return <ErrorState message={state.message} />;
  return render(state.data);
}

function MinistryRoute(): JSX.Element {
  const { ministryId } = useParams();
  return <WithData render={(data) => <MinistryPage data={data} ministryId={ministryId} />} />;
}

export default function App(): JSX.Element {
  return (
    <DataProvider>
      <HashRouter>
        <Layout>
          <Suspense fallback={<LoadingState label="טוען מסך…" />}>
            <Routes>
              <Route
                path="/"
                element={<WithSummary render={(summary) => <HomePage summary={summary} />} />}
              />
              <Route
                path="/how-to-read"
                element={<WithSummary render={(summary) => <HowToReadPage summary={summary} />} />}
              />
              <Route
                path="/scorecards"
                element={<WithSummary render={(summary) => <ScorecardsPage summary={summary} />} />}
              />
              <Route path="/corrections" element={<CorrectionsPage />} />
              <Route path="/ministry/:ministryId" element={<MinistryRoute />} />
              <Route
                path="/person/:personId"
                element={<WithData render={(data) => <PersonPage data={data} />} />}
              />
              <Route
                path="/supplier/:supplierId"
                element={<WithData render={(data) => <SupplierPage data={data} />} />}
              />
              <Route
                path="/activity"
                element={<WithData render={(data) => <ActivityPage data={data} />} />}
              />
              <Route
                path="/budget"
                element={<WithData render={(data) => <BudgetPage data={data} />} />}
              />
              <Route
                path="/analysis"
                element={<WithData render={(data) => <AnalysisPage data={data} />} />}
              />
              <Route
                path="/findings"
                element={<WithData render={(data) => <FindingsPage data={data} />} />}
              />
              <Route
                path="/diaries"
                element={<WithData render={(data) => <DiariesPage data={data} />} />}
              />
              <Route
                path="/sources"
                element={<WithData render={(data) => <SourcesPage data={data} />} />}
              />
              <Route
                path="/methodology"
                element={<WithData render={(data) => <MethodologyPage data={data} />} />}
              />
              <Route
                path="/about"
                element={<WithData render={(data) => <AboutPage data={data} />} />}
              />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </HashRouter>
    </DataProvider>
  );
}
