/**
 * Chart-shaped data, kept out of the component file so the build-time pipeline can
 * produce these shapes without pulling React into a Node script.
 */

export interface SeriesPoint {
  /** Category label, e.g. the fiscal year. */
  label: string;
  values: Record<string, number | null>;
}

export interface SeriesDefinition {
  key: string;
  label: string;
  color: string;
}
