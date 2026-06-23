/**
 * Robust extraction of the scene JSON array from an LLM response.
 *
 * Most of the time the model (with responseMimeType: application/json) returns a
 * clean array. But reasoning models — notably Gemini 3.x — can prepend thinking
 * text, or wrap the JSON in a ```json fence. This recovers the array anyway:
 *
 *   1. strip a markdown code fence if present,
 *   2. try a straight parse,
 *   3. otherwise scan for the first '[' that opens a *balanced* array and parse
 *      it — trying each '[' in turn so stray brackets in prose don't derail us.
 *
 * Dependency-free on purpose so it's unit-testable (scripts/retry.test.mjs).
 */
export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {}

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "[") continue;
    const end = matchingBracket(s, i);
    if (end === -1) continue;
    try {
      const parsed = JSON.parse(s.slice(i, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not a valid array starting here — try the next '['
    }
  }
  throw new Error("Could not parse JSON from model response");
}

/** Index of the ']' that closes the '[' at `start`, respecting strings/escapes. -1 if unbalanced. */
function matchingBracket(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
