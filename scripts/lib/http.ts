/**
 * Polite HTTP client for build-time collection only.
 *
 * Rules enforced here (see scripts/README.md):
 *  - identifying User-Agent, so source operators can see who we are;
 *  - hard timeout per request;
 *  - moderate retry with exponential backoff, only for transient failures;
 *  - a minimum delay between requests to the same host (rate courtesy);
 *  - on-disk cache, so re-running the pipeline does not re-hit sources;
 *  - every attempt is handed to the Logger, including failures.
 *
 * Nothing in this file runs in the browser. The published site performs no
 * network requests for data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CACHE_DIR, ensureDir } from './paths.js';
import type { AttemptOutcome, CollectionAttempt, Logger } from './log.js';

// Node's global fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set in
// the environment *before* the process starts (Node >= 22.21) — assigning it here
// would be too late to have any effect. Behind a proxy, invoke the collectors as
// `NODE_USE_ENV_PROXY=1 npm run data:refresh`. See scripts/README.md.

export const USER_AGENT =
  'government-transparency-map-il/1.0 (build-time public-data collector; +https://github.com/eyalbenzvi/GovernmentTracker)';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];
const MIN_HOST_DELAY_MS = 1_200;

const lastHostHit = new Map<string, number>();

export interface FetchResult {
  ok: boolean;
  status: number | null;
  body: string | null;
  bytes: number;
  outcome: AttemptOutcome;
  errorMessage: string | null;
  fromCache: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cachePath(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.body`);
}

async function respectHostRate(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastHostHit.get(host);
  if (last !== undefined) {
    const wait = MIN_HOST_DELAY_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
  }
  lastHostHit.set(host, Date.now());
}

/**
 * Detects a denial produced by the *environment's* egress allowlist rather than
 * by the source itself. Two shapes occur in practice:
 *   - the gateway answers the request with 403 and an allowlist message in the body;
 *   - a CONNECT-terminating proxy rejects the tunnel, which surfaces as an
 *     opaque "fetch failed".
 * The distinction matters: a blocked host is an environment limitation to report,
 * not a broken or forbidden source, and retrying it is pointless.
 */
export function isEgressDenial(status: number | null, body: string | null): boolean {
  if (status !== 403 || body === null) return false;
  return /not in allowlist|egress|network policy|blocked by/i.test(body);
}

/**
 * Classifies a thrown network failure. See isEgressDenial for why proxy denials
 * are reported separately from ordinary network errors.
 */
function classifyError(err: unknown): { outcome: AttemptOutcome; message: string } {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const lower = message.toLowerCase();
  const blocked =
    lower.includes('403') ||
    lower.includes('proxy') ||
    lower.includes('tunnel') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed');
  return { outcome: blocked ? 'blocked' : 'network_error', message };
}

export interface FetchOptions {
  purpose: string;
  logger: Logger;
  useCache?: boolean;
  accept?: string;
}

export async function politeFetch(url: string, options: FetchOptions): Promise<FetchResult> {
  const { purpose, logger, useCache = true, accept = 'application/json, text/html, */*' } = options;
  const startedAt = Date.now();

  if (useCache) {
    const cached = cachePath(url);
    if (fs.existsSync(cached)) {
      const body = fs.readFileSync(cached, 'utf8');
      const attempt: CollectionAttempt = {
        url,
        purpose,
        outcome: 'ok',
        httpStatus: 200,
        bytes: Buffer.byteLength(body),
        errorMessage: null,
        attemptedAt: new Date().toISOString(),
        durationMs: 0,
      };
      logger.record(attempt);
      return {
        ok: true,
        status: 200,
        body,
        bytes: attempt.bytes ?? 0,
        outcome: 'ok',
        errorMessage: null,
        fromCache: true,
      };
    }
  }

  let last: FetchResult = {
    ok: false,
    status: null,
    body: null,
    bytes: 0,
    outcome: 'network_error',
    errorMessage: 'not attempted',
    fromCache: false,
  };

  for (let attemptNo = 0; attemptNo < MAX_ATTEMPTS; attemptNo += 1) {
    await respectHostRate(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
      });
      const body = await response.text();
      const denied = isEgressDenial(response.status, body);
      last = {
        ok: response.ok,
        status: response.status,
        body: response.ok ? body : null,
        bytes: Buffer.byteLength(body),
        outcome: response.ok ? 'ok' : denied ? 'blocked' : 'http_error',
        errorMessage: response.ok
          ? null
          : denied
            ? `egress allowlist denial (HTTP 403): ${body.trim().slice(0, 160)}`
            : `HTTP ${response.status}`,
        fromCache: false,
      };
      // An allowlist denial is deterministic; retrying only adds load.
      if (denied) break;
      if (response.ok) {
        if (useCache) {
          ensureDir(CACHE_DIR);
          fs.writeFileSync(cachePath(url), body, 'utf8');
        }
        break;
      }
      // 4xx other than 429 will not improve on retry.
      if (response.status < 500 && response.status !== 429) break;
    } catch (err) {
      const { outcome, message } = classifyError(err);
      last = {
        ok: false,
        status: null,
        body: null,
        bytes: 0,
        outcome,
        errorMessage: message,
        fromCache: false,
      };
      // An egress-policy denial is deterministic; retrying only adds load.
      if (outcome === 'blocked') break;
    } finally {
      clearTimeout(timer);
    }
    const backoff = BACKOFF_MS[attemptNo];
    if (backoff !== undefined) await sleep(backoff);
  }

  logger.record({
    url,
    purpose,
    outcome: last.outcome,
    httpStatus: last.status,
    bytes: last.bytes,
    errorMessage: last.errorMessage,
    attemptedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  });

  return last;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
