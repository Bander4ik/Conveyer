import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { getPrompt } from "../prompts";
import { log } from "../logger";
import { getRunDir } from "../run-paths";
import { withRetry, withFallback, backoffMs, formatWait, RetryableError } from "../retry";

export interface Scene {
  index: number;
  text: string;
  visual_prompt: string;
  duration_hint_sec: number;
}

/**
 * Chunk threshold for scene-split.
 *
 * Gemini 2.5 Flash/Pro caps output at 65 535 tokens. A scene-split JSON
 * entry averages ~180 tokens (text + 60–120-word visual_prompt + duration),
 * so a 3 000-word script → ~300 scenes → ~54 K output — we are then
 * uncomfortably close to the hard cap. Anything longer we split into
 * ≤ 3 000-word chunks at SENTENCE boundaries and scene-split each chunk
 * separately, then concatenate. The pipeline downstream (TTS, video,
 * assembly) is unaware any chunking happened.
 *
 * Why sentence boundaries: the LLM never sees a half-sentence at the seam,
 * so coverage stays clean and no scene is born torn-in-two.
 */
const WORDS_PER_CHUNK = 3000;

/**
 * Splits the script into scenes. Supports Google Gemini (default, cheap) and
 * Anthropic Claude. Scripts longer than ~3 000 words (≈ 20–25 min of
 * narration) are automatically chunked — no manual intervention needed.
 */
export async function splitScript(runId: string, script: string): Promise<Scene[]> {
  const provider = (getSetting("SCENE_SPLIT_PROVIDER") || "google").toLowerCase();
  const systemPrompt = getPrompt("scene_split");

  const totalWords = script.trim().split(/\s+/).filter(Boolean).length;
  log(runId, "info", `Splitting script (${provider}) — ${totalWords} words`, {
    stage: "scene_split",
    data: { scriptChars: script.length, totalWords },
  });

  let allScenes: Scene[];

  if (totalWords <= WORDS_PER_CHUNK) {
    // Small enough for one pass.
    allScenes = await splitOneChunk(runId, provider, systemPrompt, script, 0);
  } else {
    // Long script — split at sentence boundaries and scene-split each chunk.
    const chunks = chunkScript(script, WORDS_PER_CHUNK);
    log(
      runId,
      "info",
      `Script is too long for one ${provider} call (over ${WORDS_PER_CHUNK} words) — ` +
        `splitting into ${chunks.length} chunks for scene_split`,
      { stage: "scene_split", data: { chunkCount: chunks.length, totalWords } }
    );

    allScenes = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkWords = chunks[i].trim().split(/\s+/).filter(Boolean).length;
      log(
        runId,
        "info",
        `Scene-splitting chunk ${i + 1}/${chunks.length} (${chunkWords} words)`,
        { stage: "scene_split" }
      );
      const chunkScenes = await splitOneChunk(
        runId,
        provider,
        systemPrompt,
        chunks[i],
        allScenes.length
      );
      allScenes.push(...chunkScenes);
    }
  }

  // Coverage check — words in scene.text vs original script. <70% means the
  // model summarized; we warn but still return what we got.
  const sceneWords = allScenes.reduce(
    (sum, s) => sum + s.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );
  const coverage = totalWords > 0 ? (sceneWords / totalWords) * 100 : 0;

  log(
    runId,
    "success",
    `Done: ${allScenes.length} scenes · script coverage ${coverage.toFixed(0)}% (${sceneWords}/${totalWords} words)`,
    {
      stage: "scene_split",
      data: { scenes: allScenes.slice(0, 5).map((s) => ({ i: s.index, text: s.text.slice(0, 60) })) },
    }
  );

  if (coverage < 70) {
    log(
      runId,
      "warn",
      `⚠️ Low coverage (${coverage.toFixed(0)}%) — the model likely summarized the script. Review the scene_split prompt on /prompts.`,
      { stage: "scene_split" }
    );
  }

  return allScenes;
}

/**
 * Sends one chunk of script to the configured LLM and returns its scenes,
 * re-indexed starting at `sceneIndexOffset` so they line up inside the
 * full-script scene array.
 */
async function splitOneChunk(
  runId: string,
  provider: string,
  systemPrompt: string,
  scriptChunk: string,
  sceneIndexOffset: number
): Promise<Scene[]> {
  let raw: string;
  if (provider === "google") {
    raw = await splitWithGemini(systemPrompt, scriptChunk, runId);
  } else if (provider === "anthropic") {
    raw = await splitWithClaude(systemPrompt, scriptChunk, runId);
  } else {
    throw new Error(`Unknown SCENE_SPLIT_PROVIDER: ${provider}`);
  }

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    // Save raw output so we can see what went wrong — one file per chunk so
    // chunks don't overwrite each other's dumps.
    try {
      const runDir = getRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });
      const filename = `scene_split_raw_${sceneIndexOffset}.txt`;
      fs.writeFileSync(path.join(runDir, filename), raw, "utf-8");
      log(runId, "error", `Raw output saved to ${runDir}/${filename} (${raw.length} chars)`, {
        stage: "scene_split",
      });
    } catch {}
    throw e;
  }
  if (!Array.isArray(json)) {
    log(runId, "error", "LLM did not return an array", {
      stage: "scene_split",
      data: { raw: raw.slice(0, 500) },
    });
    throw new Error("scene_split: model did not return a JSON array");
  }

  return json.map((s, i) => ({
    index: sceneIndexOffset + i,
    text: String(s.text ?? ""),
    visual_prompt: String(s.visual_prompt ?? ""),
    duration_hint_sec: Number(s.duration_hint_sec ?? 6),
  }));
}

/**
 * Splits a script into chunks at sentence boundaries, targeting `targetWords`
 * per chunk. A "sentence" is anything up to a `.`, `!` or `?`.
 *
 * If the script has no sentence terminators we return it whole — bad chunking
 * is worse than no chunking, and the only way to get here is a script written
 * without punctuation, which won't scene-split well anyway.
 */
function chunkScript(script: string, targetWords: number): string[] {
  const sentenceRegex = /[^.!?]+[.!?]+["')\]]*\s*/g;
  const matches = script.match(sentenceRegex);
  if (!matches || matches.length === 0) return [script];

  // If the regex didn't consume the trailing characters (e.g. a final
  // sentence without a terminator), append the leftover so we cover 100%
  // of the script.
  const sentences: string[] = [...matches];
  const captured = matches.join("");
  if (captured.length < script.length) {
    sentences.push(script.slice(captured.length));
  }

  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;
  for (const sent of sentences) {
    const sentWords = sent.trim().split(/\s+/).filter(Boolean).length;
    if (currentWords > 0 && currentWords + sentWords > targetWords) {
      chunks.push(current.trim());
      current = "";
      currentWords = 0;
    }
    current += sent;
    currentWords += sentWords;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

// ── Transient-failure policy for scene-split ──────────────────────────────
//
// Gemini "This model is currently experiencing high demand" (503 UNAVAILABLE)
// can persist for MINUTES, not seconds. The old policy retried 4× over ~15 s
// total and then crashed the whole run — so a brief capacity spike at the very
// first stage threw away the entire job. We now wait it out the same way the
// 69labs path does (services/labs69.ts): fast at first (most blips clear in
// seconds), escalating to a 15-minute ceiling, for a total window of ~2 h
// before finally giving up. Each wait is logged to the run so the user sees
// "paused, retrying" instead of a silent gap followed by a crash.
const HTTP_RETRYABLE = new Set([429, 500, 502, 503, 504]);
// Anthropic adds 529 (Overloaded) and 408/409 to the transient set.
const CLAUDE_RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const SPLIT_MAX_RETRIES = 15; // 16 tries total — the LAST model in the chain gets this full ~2 h patience
const SPLIT_PROBE_RETRIES = 4; // earlier models in the chain: ~30 s (2+4+8+16) before pivoting to the fallback
const SPLIT_BACKOFF = { baseMs: 2000, factor: 2, capMs: 15 * 60_000 }; // 2s,4s,…→15min; ~2 h total
// A hung connection must not stall the run forever. A ~3 000-word chunk →
// up to ~54 K output tokens is well under 3 min on flash; beyond that we abort
// and retry rather than hang.
const GEMINI_REQUEST_TIMEOUT_MS = 3 * 60_000;

/** Shared onRetry logger — surfaces each backoff wait in the run log. */
function logRetry(runId: string, provider: string) {
  return ({ attempt, maxRetries, waitMs, err }: { attempt: number; maxRetries: number; waitMs: number; err: unknown }) => {
    const reason = err instanceof RetryableError && err.status ? `HTTP ${err.status}` : "transient error";
    log(
      runId,
      "warn",
      `${provider} unavailable (${reason}) — waiting ${formatWait(waitMs)} then retrying (${attempt}/${maxRetries}). The run is paused, not failing.`,
      { stage: "scene_split" }
    );
  };
}

/** fetch with an abort timeout — a hung connection must not stall the run forever. */
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function splitWithGemini(systemPrompt: string, script: string, runId: string): Promise<string> {
  const apiKey = getSetting("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set (Settings)");

  // Model fallback chain. 503 "high demand" is per-model capacity: when Google
  // is congesting the primary model, a DIFFERENT model usually sails straight
  // through because it sits on a separate capacity pool. So we probe the
  // primary briefly (~30 s) and, if it keeps 503-ing, pivot to the fallback
  // model — which then gets the full ~2 h patience. Both default to models with
  // a 65 535-token output cap, so long chunks are never truncated.
  const primary = getSetting("SCENE_SPLIT_MODEL") || "gemini-2.5-flash";
  const fallback = (getSetting("SCENE_SPLIT_FALLBACK_MODEL") || "").trim();
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Script:\n\n${script}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
      // 65535 — output cap shared by gemini-2.5-flash and gemini-3.1-flash-lite.
      // Per-chunk we target ~3 000 words of input → ~54 K of output, leaving an
      // 11 K-token buffer before the hard cap. Anything that still overflows
      // surfaces below with a clear "split the script" message.
      maxOutputTokens: 65535,
      // Disable thinking — for structured output it just wastes the token budget
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return withFallback(
    models,
    (model, isLast) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      return withRetry(() => geminiGenerateOnce(url, body), {
        // Earlier models pivot fast; the last model gets the full ~2 h patience.
        maxRetries: isLast ? SPLIT_MAX_RETRIES : SPLIT_PROBE_RETRIES,
        isRetryable: (e) => e instanceof RetryableError,
        delayMs: (attempt) => backoffMs(attempt, SPLIT_BACKOFF),
        onRetry: logRetry(runId, model),
      });
    },
    {
      // Pivot ONLY on a transient (503-type) exhaustion. A real error (bad key,
      // bad request) would fail the fallback the same way — surface it instead.
      isRetryable: (e) => e instanceof RetryableError,
      onFallback: (from, to) =>
        log(
          runId,
          "warn",
          `${from} still unavailable after ${SPLIT_PROBE_RETRIES + 1} attempts — switching to fallback model ${to}`,
          { stage: "scene_split" }
        ),
    }
  );
}

/**
 * One Gemini generateContent call. Throws {@link RetryableError} for transient
 * failures (429/5xx, network blip, timeout) so withRetry waits them out;
 * throws a plain Error for permanent problems (bad key, output cut off) so they
 * surface immediately instead of looping for 2 hours.
 */
async function geminiGenerateOnce(url: string, body: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      GEMINI_REQUEST_TIMEOUT_MS
    );
  } catch (e) {
    // Network error or aborted (timeout) — transient, wait and retry.
    throw new RetryableError(`Gemini request failed: ${(e as Error).message}`);
  }

  if (!resp.ok) {
    const msg = `Gemini ${resp.status}: ${(await resp.text()).slice(0, 400)}`;
    if (HTTP_RETRYABLE.has(resp.status)) throw new RetryableError(msg, resp.status);
    throw new Error(msg); // 4xx (bad key / bad request) — retrying won't help
  }

  const json = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { candidatesTokenCount?: number };
  };
  const cand = json.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const reason = cand?.finishReason;
  if (reason && reason !== "STOP") {
    throw new Error(
      `Gemini finish=${reason} (output cut off, tokens=${json.usageMetadata?.candidatesTokenCount}). ` +
        `Even a single ~3 000-word chunk produced more than Gemini's 65 535-token output cap — ` +
        `try lowering WORDS_PER_CHUNK in scene-split.ts, or shorten this script chunk's visual_prompt instructions.`
    );
  }
  if (!text) throw new Error(`Gemini: empty output (${JSON.stringify(json).slice(0, 300)})`);
  return text;
}

async function splitWithClaude(systemPrompt: string, script: string, runId: string): Promise<string> {
  const apiKey = getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (Settings)");
  const model = getSetting("SCENE_SPLIT_MODEL") || "claude-sonnet-4-6";
  // Disable the SDK's own short retries; withRetry owns the long-wait policy so
  // a sustained 529 Overloaded waits out the same ~2 h window as Gemini.
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  const callOnce = async (): Promise<string> => {
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Script:\n\n${script}` }],
      });
      return resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== undefined && CLAUDE_RETRYABLE.has(status)) {
        throw new RetryableError(`Claude ${status}: ${(e as Error).message}`, status);
      }
      throw e;
    }
  };

  return withRetry(callOnce, {
    maxRetries: SPLIT_MAX_RETRIES,
    isRetryable: (e) => e instanceof RetryableError,
    delayMs: (attempt) => backoffMs(attempt, SPLIT_BACKOFF),
    onRetry: logRetry(runId, "Claude"),
  });
}

/** Extracts the first JSON array from a text response, even if the model added markdown. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    throw new Error("Could not parse JSON from model response");
  }
}
