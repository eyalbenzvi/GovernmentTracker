/**
 * Tenure-aware attribution.
 *
 * The site publishes measures about named office-holders. Without this module a
 * quarter of diary rows, or a fiscal year of budget movement, is read against
 * whoever holds the office now — which is not an imprecision but a wrong
 * attribution. Everything here answers one question: over the period this figure
 * covers, who actually held the office, and for how much of it?
 */
import type { MinisterTenure } from '../types/domain';

export interface TenureSegment {
  tenure: MinisterTenure;
  /** Clipped to the requested window. */
  fromDate: string;
  toDate: string;
  /** Days of the window this holder covered. */
  days: number;
  /** Share of the window, one decimal. */
  sharePercent: number;
}

export interface TenureAttribution {
  windowStart: string;
  windowEnd: string;
  segments: TenureSegment[];
  /** True when more than one holder covered the window. */
  isSplit: boolean;
  /** Days in the window not covered by any collected tenure. */
  uncoveredDays: number;
  /** The holder covering the largest share, when there is one. */
  dominant: TenureSegment | null;
}

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function overlapDays(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): { from: number; to: number; days: number } | null {
  const from = Math.max(aStart, bStart);
  const to = Math.min(aEnd, bEnd);
  if (to < from) return null;
  return { from, to, days: Math.round((to - from) / DAY_MS) + 1 };
}

/**
 * Which office-holders covered [windowStart, windowEnd], and by how much.
 *
 * A tenure with no start date cannot be placed on a timeline and is skipped —
 * the window's uncovered days report that gap rather than absorbing it. A tenure
 * with no end date is treated as running to the end of the window, which is what
 * "currently serving" means for attribution purposes.
 */
export function attributeWindow(
  tenures: readonly MinisterTenure[],
  windowStart: string,
  windowEnd: string,
): TenureAttribution {
  const start = toMs(windowStart);
  const end = toMs(windowEnd);
  const empty: TenureAttribution = {
    windowStart,
    windowEnd,
    segments: [],
    isSplit: false,
    uncoveredDays: 0,
    dominant: null,
  };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return empty;

  const windowDays = Math.round((end - start) / DAY_MS) + 1;
  const segments: TenureSegment[] = [];

  for (const tenure of tenures) {
    if (tenure.startDate === null) continue;
    const tStart = toMs(tenure.startDate);
    const tEnd = tenure.endDate === null ? end : toMs(tenure.endDate);
    if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) continue;
    const overlap = overlapDays(start, end, tStart, tEnd);
    if (overlap === null) continue;
    segments.push({
      tenure,
      fromDate: toIso(overlap.from),
      toDate: toIso(overlap.to),
      days: overlap.days,
      sharePercent: Math.round((overlap.days / windowDays) * 1000) / 10,
    });
  }

  segments.sort((a, b) => a.fromDate.localeCompare(b.fromDate));

  // Uncovered days are counted on the union of segments, so two holders whose
  // periods overlap (a minister and a deputy) do not create phantom coverage.
  const covered = new Set<string>();
  for (const segment of segments) {
    for (let ms = toMs(segment.fromDate); ms <= toMs(segment.toDate); ms += DAY_MS) {
      covered.add(toIso(ms));
    }
  }

  const distinctHolders = new Set(segments.map((s) => s.tenure.personName));
  const dominant = segments.reduce<TenureSegment | null>(
    (best, s) => (best === null || s.days > best.days ? s : best),
    null,
  );

  return {
    windowStart,
    windowEnd,
    segments,
    isSplit: distinctHolders.size > 1,
    uncoveredDays: Math.max(0, windowDays - covered.size),
    dominant,
  };
}

/** The tenures of one ministry, ordered, with the current holders last. */
export function tenuresForMinistry(
  tenures: readonly MinisterTenure[],
  ministryId: string,
): MinisterTenure[] {
  return tenures
    .filter((t) => t.ministryId === ministryId)
    .sort(
      (a, b) =>
        (a.startDate ?? '').localeCompare(b.startDate ?? '') ||
        a.personName.localeCompare(b.personName, 'he'),
    );
}

export interface PersonProfile {
  /** Slug used in the URL; stable for a given name. */
  id: string;
  personName: string;
  tenures: MinisterTenure[];
  ministryIds: string[];
  roles: string[];
  firstStart: string | null;
  lastEnd: string | null;
  /** True when every collected tenure of this person has ended. */
  hasEnded: boolean;
}

/**
 * A stable, URL-safe id for a Hebrew person name.
 *
 * Deliberately *not* percent-encoded: React Router encodes a path segment on the
 * way out and decodes it on the way in, so an already-encoded id would arrive
 * decoded and never match. Slashes are the only character that would break the
 * route, so they are the only one replaced.
 */
export function personId(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/["'׳״]/g, '')
    .replace(/\//g, '-');
}

/** Groups tenures into one profile per person, which is what a person page shows. */
export function personProfiles(tenures: readonly MinisterTenure[]): PersonProfile[] {
  const byName = new Map<string, MinisterTenure[]>();
  for (const tenure of tenures) {
    const list = byName.get(tenure.personName) ?? [];
    list.push(tenure);
    byName.set(tenure.personName, list);
  }

  const profiles: PersonProfile[] = [];
  for (const [personName, list] of byName) {
    const sorted = [...list].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
    const starts = sorted
      .map((t) => t.startDate)
      .filter((d): d is string => d !== null)
      .sort();
    const ends = sorted.map((t) => t.endDate);
    const allEnded = ends.every((e): e is string => e !== null);
    const sortedEnds = allEnded ? [...ends].sort() : [];
    profiles.push({
      id: personId(personName),
      personName,
      tenures: sorted,
      ministryIds: [...new Set(sorted.map((t) => t.ministryId))],
      roles: [...new Set(sorted.map((t) => t.role))],
      firstStart: starts[0] ?? null,
      lastEnd: sortedEnds[sortedEnds.length - 1] ?? null,
      hasEnded: allEnded,
    });
  }

  return profiles.sort((a, b) => a.personName.localeCompare(b.personName, 'he'));
}
