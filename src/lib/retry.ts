/**
 * Generic "wait through a transient outage instead of crashing" helper.
 *
 * The pipeline already does this for 69labs (rate limit / hourly credit cap —
 * see services/labs69.ts). This is the same idea factored out so the Gemini
 * scene-split path can wait out a "model is experiencing high demand" (503)
 * spike rather than failing the whole run after a few seconds.
 *
 * Pure + dependency-free on purpose: `sleep` is injectable so the behaviour is
 * unit-testable without real waiting (see scripts/retry.test.mjs).
 */

/** Error a retryable operation throws when it wants `withRetry` to back off and try again. */
export class RetryableError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RetryableError";
    this.status = status;
  }
}

/**
 * Capped exponential backoff. `attempt` is 0-based (0 = the wait before the
 * first retry). Returns the delay in ms, never exceeding `capMs`.
 *
 *   backoffMs(0) = baseMs
 *   backoffMs(n) = min(baseMs * factor^n, capMs)
 */
export function backoffMs(
  attempt: number,
  opts: { baseMs?: number; factor?: number; capMs?: number } = {}
): number {
  const { baseMs = 2000, factor = 2, capMs = 15 * 60_000 } = opts;
  const raw = baseMs * Math.pow(factor, Math.max(0, attempt));
  return Math.min(raw, capMs);
}

export interface RetryOptions {
  /** Max number of retries AFTER the first attempt. Total tries = maxRetries + 1. */
  maxRetries: number;
  /** Should this thrown error trigger a retry? Anything returning false propagates immediately. */
  isRetryable: (err: unknown) => boolean;
  /** Delay before the (attempt+1)-th try, where attempt is 0-based. */
  delayMs: (attempt: number) => number;
  /** Called right before each wait — use it to surface the retry in the UI/log. */
  onRetry?: (info: { attempt: number; maxRetries: number; waitMs: number; err: unknown }) => void;
  /** Injectable for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying retryable failures with the given backoff until it
 * succeeds or `maxRetries` is exhausted (then the last error is rethrown).
 * Non-retryable errors propagate immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!opts.isRetryable(err) || attempt >= opts.maxRetries) throw err;
      const waitMs = opts.delayMs(attempt);
      opts.onRetry?.({ attempt: attempt + 1, maxRetries: opts.maxRetries, waitMs, err });
      await sleep(waitMs);
      attempt++;
    }
  }
}

/** Format a wait for log lines: "8s", "2 min", "15 min". */
export function formatWait(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`;
}

/**
 * Try `attempt(item)` for each item in order until one succeeds. If a NON-last
 * item fails with a retryable error, move on to the next item (calling
 * `onFallback`); a non-retryable error, or the last item's error, propagates.
 *
 * Used by scene-split to probe a primary model briefly and then pivot to a
 * fallback model when the primary keeps returning 503 — the fallback sits on a
 * separate capacity pool, so it usually works while the primary is congested.
 */
export async function withFallback<I, T>(
  items: I[],
  attempt: (item: I, isLast: boolean, index: number) => Promise<T>,
  opts: { isRetryable: (err: unknown) => boolean; onFallback?: (from: I, to: I) => void }
): Promise<T> {
  if (items.length === 0) throw new Error("withFallback: no items to try");
  let lastErr: unknown;
  for (let i = 0; i < items.length; i++) {
    const isLast = i === items.length - 1;
    try {
      return await attempt(items[i], isLast, i);
    } catch (err) {
      lastErr = err;
      if (opts.isRetryable(err) && !isLast) {
        opts.onFallback?.(items[i], items[i + 1]);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
