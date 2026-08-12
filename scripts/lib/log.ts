/**
 * Structured collection logging.
 *
 * Every network attempt a collector makes is recorded — success or failure —
 * and persisted under data/raw/collection-log/. The log is part of the
 * repository on purpose: it is the evidence for what the build could and could
 * not reach, and it is what the site's coverage/methodology screens report.
 */
import path from 'node:path';
import { COLLECTION_LOG_DIR, writeJson } from './paths.js';

export type AttemptOutcome = 'ok' | 'http_error' | 'network_error' | 'blocked' | 'parse_error';

export interface CollectionAttempt {
  url: string;
  purpose: string;
  outcome: AttemptOutcome;
  httpStatus: number | null;
  bytes: number | null;
  errorMessage: string | null;
  attemptedAt: string;
  durationMs: number;
}

export interface CollectionLog {
  collectorId: string;
  startedAt: string;
  finishedAt: string;
  environmentNote: string;
  attempts: CollectionAttempt[];
  summary: {
    total: number;
    ok: number;
    blocked: number;
    failed: number;
  };
}

export class Logger {
  private readonly attempts: CollectionAttempt[] = [];
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly collectorId: string) {}

  record(attempt: CollectionAttempt): void {
    this.attempts.push(attempt);
    const mark = attempt.outcome === 'ok' ? '✓' : attempt.outcome === 'blocked' ? '⛔' : '✗';
    console.log(
      `  ${mark} [${attempt.outcome}] ${attempt.url}` +
        (attempt.errorMessage ? ` — ${attempt.errorMessage}` : ''),
    );
  }

  get all(): readonly CollectionAttempt[] {
    return this.attempts;
  }

  get okCount(): number {
    return this.attempts.filter((a) => a.outcome === 'ok').length;
  }

  get blockedCount(): number {
    return this.attempts.filter((a) => a.outcome === 'blocked').length;
  }

  flush(environmentNote: string): CollectionLog {
    const log: CollectionLog = {
      collectorId: this.collectorId,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      environmentNote,
      attempts: this.attempts,
      summary: {
        total: this.attempts.length,
        ok: this.okCount,
        blocked: this.blockedCount,
        failed: this.attempts.filter((a) => a.outcome !== 'ok' && a.outcome !== 'blocked').length,
      },
    };
    writeJson(path.join(COLLECTION_LOG_DIR, `${this.collectorId}.json`), log);
    console.log(
      `\n${this.collectorId}: ${log.summary.ok} ok · ${log.summary.blocked} blocked · ${log.summary.failed} failed`,
    );
    return log;
  }
}
