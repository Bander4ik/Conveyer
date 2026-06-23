// Behavioural test for the scene-split retry policy.
//
// Runs the REAL production code (src/lib/retry.ts) with an injected, instant
// `sleep` so we exercise the exact backoff/loop logic without waiting hours.
//
//   node scripts/retry.test.mjs
//
// No dependencies, no node_modules required (retry.ts is dependency-free).
import assert from "node:assert/strict";
import { backoffMs, withRetry, withFallback, RetryableError, formatWait } from "../src/lib/retry.ts";

let passed = 0;
const ok = (label) => { console.log(`  ✓ ${label}`); passed++; };

// The exact policy scene-split.ts uses.
const BACKOFF = { baseMs: 2000, factor: 2, capMs: 15 * 60_000 };
const MAX_RETRIES = 15;
const delayMs = (a) => backoffMs(a, BACKOFF);

// ── 1. Backoff schedule ──────────────────────────────────────────────────
console.log("backoffMs schedule:");
{
  assert.equal(backoffMs(0, BACKOFF), 2000, "first wait is 2s");
  // strictly increasing until the cap, then pinned at the cap
  const seq = Array.from({ length: MAX_RETRIES }, (_, i) => delayMs(i));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1], "non-decreasing");
  assert.equal(Math.max(...seq), 15 * 60_000, "ceiling is exactly 15 min");
  assert.ok(seq.every((ms) => ms <= 15 * 60_000), "no wait ever exceeds 15 min");
  ok("starts at 2s, escalates, hard-caps at 15 min");

  const totalMin = seq.reduce((s, ms) => s + ms, 0) / 60_000;
  assert.ok(totalMin > 100 && totalMin < 140, `total window ~2h (got ${totalMin.toFixed(0)} min)`);
  ok(`total patience across ${MAX_RETRIES} retries ≈ ${totalMin.toFixed(0)} min (~2 h)`);
}

// ── 2. Succeeds first try → no retries, no sleeps ──────────────────────────
console.log("withRetry happy path:");
{
  let calls = 0;
  const sleeps = [];
  const out = await withRetry(async () => { calls++; return "done"; }, {
    maxRetries: MAX_RETRIES, isRetryable: () => true, delayMs,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(out, "done");
  assert.equal(calls, 1, "called once");
  assert.equal(sleeps.length, 0, "never slept");
  ok("returns immediately, zero waits");
}

// ── 3. THE CLIENT'S BUG: a long 503 storm now recovers instead of crashing ─
console.log("Gemini 503 storm (the reported failure):");
{
  // Gemini is "experiencing high demand" for 6 straight calls, then recovers.
  // The OLD policy (4 retries / ~15s) would have crashed the whole run here.
  const FAILS = 6;
  let calls = 0;
  const waits = [];
  const retryLog = [];

  const result = await withRetry(
    async () => {
      calls++;
      if (calls <= FAILS) {
        throw new RetryableError(
          'Gemini 503: {"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
          503
        );
      }
      return '[{"text":"scene 1","visual_prompt":"...","duration_hint_sec":6}]';
    },
    {
      maxRetries: MAX_RETRIES,
      isRetryable: (e) => e instanceof RetryableError,
      delayMs,
      sleep: async (ms) => { waits.push(ms); },
      onRetry: ({ attempt, maxRetries, waitMs, err }) =>
        retryLog.push(`Gemini unavailable (HTTP ${err.status}) — waiting ${formatWait(waitMs)}, retry ${attempt}/${maxRetries}`),
    }
  );

  assert.ok(result.startsWith("["), "eventually returns the scene JSON");
  assert.equal(calls, FAILS + 1, `tried ${FAILS + 1}× (would have died at 5 under the old policy)`);
  assert.equal(waits.length, FAILS, "waited once per failure");
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 32000, 64000], "real escalating backoff");
  assert.ok(waits.every((ms) => ms <= 15 * 60_000), "no wait exceeds the 15-min ceiling");
  ok(`survived ${FAILS} consecutive 503s and produced scenes`);
  console.log("    run-log would show:");
  retryLog.forEach((l) => console.log(`      ${l}`));
}

// ── 4. Non-retryable error (bad API key) fails fast — no 2h loop ────────────
console.log("Non-retryable error:");
{
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error("GOOGLE_API_KEY invalid (400)"); }, {
      maxRetries: MAX_RETRIES, isRetryable: (e) => e instanceof RetryableError, delayMs,
      sleep: async (ms) => { sleeps.push(ms); },
    }),
    /invalid/
  );
  assert.equal(calls, 1, "did not retry a permanent error");
  assert.equal(sleeps.length, 0, "no waiting on a permanent error");
  ok("bad key surfaces immediately (no pointless 2h wait)");
}

// ── 5. Sustained outage past the budget → gives up cleanly ──────────────────
console.log("Outage longer than the whole budget:");
{
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new RetryableError("Gemini 503", 503); }, {
      maxRetries: MAX_RETRIES, isRetryable: (e) => e instanceof RetryableError, delayMs,
      sleep: async (ms) => { sleeps.push(ms); },
    }),
    /503/
  );
  assert.equal(calls, MAX_RETRIES + 1, `exhausted all ${MAX_RETRIES + 1} tries`);
  assert.equal(sleeps.length, MAX_RETRIES, "waited between every try");
  ok("after ~2h of trying, fails with the real error (doesn't hang forever)");
}

// ── 6. Model fallback: pivot to a different model on persistent 503 ─────────
console.log("withFallback (Gemini model fallback chain):");
{
  // Primary retryable-fails → pivot to fallback → fallback succeeds.
  const tried = [];
  const fellOver = [];
  const out = await withFallback(
    ["gemini-2.5-flash", "gemini-3.1-flash-lite"],
    async (model) => {
      tried.push(model);
      if (model === "gemini-2.5-flash") throw new RetryableError("Gemini 503", 503);
      return `scenes from ${model}`;
    },
    { isRetryable: (e) => e instanceof RetryableError, onFallback: (from, to) => fellOver.push([from, to]) }
  );
  assert.equal(out, "scenes from gemini-3.1-flash-lite", "returned the fallback's result");
  assert.deepEqual(tried, ["gemini-2.5-flash", "gemini-3.1-flash-lite"], "tried primary then fallback");
  assert.deepEqual(fellOver, [["gemini-2.5-flash", "gemini-3.1-flash-lite"]], "logged exactly one pivot");
  ok("pivots to the fallback model when the primary is unavailable");

  // Non-retryable on primary → do NOT pivot (a bad key would fail the fallback too).
  const tried2 = [];
  await assert.rejects(
    () => withFallback(
      ["gemini-2.5-flash", "gemini-3.1-flash-lite"],
      async (model) => { tried2.push(model); throw new Error("API key invalid (400)"); },
      { isRetryable: (e) => e instanceof RetryableError }
    ),
    /invalid/
  );
  assert.deepEqual(tried2, ["gemini-2.5-flash"], "did NOT waste an attempt on the fallback");
  ok("a real error (bad key) surfaces without pivoting");
}

// ── 7. The real shape: withFallback wrapping withRetry (probe then pivot) ────
console.log("Realistic scene-split: primary 503s through its probe, fallback saves the run:");
{
  const PROBE = 4, MAX = 15;
  const primaryWaits = [];
  const calls = { "gemini-2.5-flash": 0, "gemini-3.1-flash-lite": 0 };

  const result = await withFallback(
    ["gemini-2.5-flash", "gemini-3.1-flash-lite"],
    (model, isLast) =>
      withRetry(
        async () => {
          calls[model]++;
          if (model === "gemini-2.5-flash") throw new RetryableError("Gemini 503", 503); // primary fully down
          return '[{"text":"scene 1"}]'; // fallback works first try
        },
        {
          maxRetries: isLast ? MAX : PROBE,
          isRetryable: (e) => e instanceof RetryableError,
          delayMs,
          sleep: async (ms) => { if (model === "gemini-2.5-flash") primaryWaits.push(ms); },
        }
      ),
    { isRetryable: (e) => e instanceof RetryableError }
  );

  assert.ok(result.startsWith("["), "run produced scenes via the fallback");
  assert.equal(calls["gemini-2.5-flash"], PROBE + 1, `primary probed ${PROBE + 1}x (~30s) then gave up`);
  assert.equal(calls["gemini-3.1-flash-lite"], 1, "fallback succeeded on the first try");
  assert.deepEqual(primaryWaits, [2000, 4000, 8000, 16000], "primary used the short ~30s probe budget, not the full 2h");
  ok("primary probed briefly → pivoted to fallback → run completed");
}

console.log(`\n${passed} checks passed ✅`);
