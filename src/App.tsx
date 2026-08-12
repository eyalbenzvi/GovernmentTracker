/**
 * Routing.
 *
 * HashRouter is used deliberately: GitHub Pages serves static files with no
 * rewrite rules, so a path-based router would 404 on a deep link or a refresh.
 * Hash routes (`/#/ministry/transport`) work from any static host, including a
 * project sub-path, with no server configuration.
 */
import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DataProvider, useDataState } from './data/DataProvider';
import { Layout } from './components/Layout';
import { ErrorState, LoadingState } from './components/ui';
import type { Dataset } from './types/domain';
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
const MethodologyPage = lazy(() =>
  import('./pages/MethodologyPage').then((m) => ({ default: m.MethodologyPage })),
);
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));

/** Renders a page only once the datasets are available, with real loading/error states. */
function WithData({ render }: { render: (data: Dataset) => JSX.Element }): JSX.Element {
  const state = useDataState();
  if (state.status === 'loading') return <LoadingState />;
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
              <Route path="/" element={<WithData render={(data) => <HomePage data={data} />} />} />
              <Route path="/ministry/:ministryId" element={<MinistryRoute />} />
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
