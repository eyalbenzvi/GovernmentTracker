/**
 * Two contexts, one for each loading tier.
 *
 * `useSummaryState` resolves from a file of tens of kilobytes, so the layout and the
 * home screen render almost immediately. `useDataState` triggers the full 12MB load
 * the first time a screen asks for it, which is why it is a hook with a side effect
 * rather than a plain context read: the corpus should never be fetched for a reader
 * who only opened the front page.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Dataset } from '../types/domain';
import type { SiteSummary } from '../types/summary';
import { getDataset, getSummary } from './datasets';

type State<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

const SummaryContext = createContext<State<SiteSummary>>({ status: 'loading' });
const DatasetContext = createContext<{
  state: State<Dataset>;
  request: () => void;
}>({ state: { status: 'loading' }, request: () => undefined });

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'שגיאה לא מזוהה בטעינת הנתונים';
}

export function DataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [summary, setSummary] = useState<State<SiteSummary>>({ status: 'loading' });
  const [dataset, setDataset] = useState<State<Dataset>>({ status: 'loading' });
  const requested = useRef(false);

  useEffect(() => {
    let alive = true;
    getSummary()
      .then((data) => {
        if (alive) setSummary({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (alive) setSummary({ status: 'error', message: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  function request(): void {
    if (requested.current) return;
    requested.current = true;
    getDataset()
      .then((data) => setDataset({ status: 'ready', data }))
      .catch((err: unknown) => setDataset({ status: 'error', message: errorMessage(err) }));
  }

  return (
    <SummaryContext.Provider value={summary}>
      <DatasetContext.Provider value={{ state: dataset, request }}>
        {children}
      </DatasetContext.Provider>
    </SummaryContext.Provider>
  );
}

export function useSummaryState(): State<SiteSummary> {
  return useContext(SummaryContext);
}

/**
 * Asks for the full corpus and reports its state. The request is fired in an
 * effect, so a screen that renders this hook starts the download and shows a
 * skeleton until it lands.
 */
export function useDataState(): State<Dataset> {
  const { state, request } = useContext(DatasetContext);
  useEffect(() => {
    request();
    // `request` is stable for the life of the provider and guards itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
