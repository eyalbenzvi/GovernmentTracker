import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Dataset } from '../types/domain';
import { getDataset } from './datasets';

type State =
  { status: 'loading' } | { status: 'ready'; data: Dataset } | { status: 'error'; message: string };

const DataContext = createContext<State>({ status: 'loading' });

export function DataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    getDataset()
      .then((data) => {
        if (alive) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'שגיאה לא מזוהה בטעינת הנתונים',
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useDataState(): State {
  return useContext(DataContext);
}
