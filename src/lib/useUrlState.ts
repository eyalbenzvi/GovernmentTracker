/**
 * Filter state that lives in the address bar.
 *
 * Every filter on the site used to be local component state, which meant a view
 * could not be shared, bookmarked, cited or reached with the back button — on a site
 * whose readers are journalists and researchers. These hooks keep the state in the
 * query string, with the default value omitted so a pristine screen still has a
 * clean URL.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A single string filter, synced to `?key=value`.
 * Setting it back to `defaultValue` removes the parameter.
 */
export function useUrlParam(key: string, defaultValue: string): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === defaultValue || next === '') {
            updated.delete(key);
          } else {
            updated.set(key, next);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [defaultValue, key, setParams],
  );

  return [value, setValue];
}

/** A numeric filter, kept as text in the URL so "all" stays expressible. */
export function useUrlNumber(key: string, defaultValue: number): [number, (next: number) => void] {
  const [raw, setRaw] = useUrlParam(key, String(defaultValue));
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : defaultValue;
  const setValue = useCallback((next: number) => setRaw(String(next)), [setRaw]);
  return [value, setValue];
}
