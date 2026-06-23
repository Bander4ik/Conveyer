// Server-only module — runs once per dev server start to seed default settings/prompts.
import { seedDefaults, getSetting, setSetting } from "./settings";
import { seedPromptDefaults } from "./prompts";

let inited = false;
export function ensureInit() {
  if (inited) return;
  seedDefaults();
  seedPromptDefaults();

  // One-time migration: the old ANIMATION_PROVIDER default was "off", which
  // meant the pipeline silently skipped img2vid and produced a Ken-Burns
  // slideshow instead of the half-and-half mix users expect. Flip existing
  // DBs still on the legacy default to "69labs" so first-half clips kick
  // in. Users who explicitly chose `replicate` / `fal` are untouched; users
  // who actually want a static-image-only video can re-set it to "off" via
  // /advanced.
  if (getSetting("ANIMATION_PROVIDER") === "off") {
    setSetting("ANIMATION_PROVIDER", "69labs");
  }

  // One-time migration: the old TTS default pointed at Edge TTS
  // (TTS_VOICE_PROVIDER=edgetts + en-US-GuyNeural) even though the voice
  // fine-tuning defaults (stability / similarity / style / speaker-boost) are
  // all ElevenLabs-only — an inconsistency. The intended default is ElevenLabs
  // through 69labs. Flip ONLY DBs still on that exact untouched legacy combo
  // so a deliberate Edge / cloned-voice choice (any other voice id) is left
  // alone. Anyone who wants free Edge TTS can re-pick it in /advanced.
  if (
    getSetting("TTS_VOICE_PROVIDER") === "edgetts" &&
    getSetting("TTS_VOICE_ID") === "en-US-GuyNeural"
  ) {
    setSetting("TTS_VOICE_PROVIDER", "elevenlabs");
    setSetting("TTS_VOICE_ID", "G17SuINrv2H9FC6nvetn");
    if (!getSetting("TTS_MODEL")) setSetting("TTS_MODEL", "eleven_multilingual_v2");
  }

  // One-time migration: the old SCENE_SPLIT_MODEL default was the floating
  // alias "gemini-flash-latest". Google can repoint that alias to a brand-new,
  // often capacity-constrained preview model — a frequent source of 503 "high
  // demand" failures and scene-split drift. Pin existing DBs still on that exact
  // legacy alias to the stable GA model "gemini-2.5-flash". A deliberate choice
  // (gemini-2.5-pro, a claude-* model, etc.) is left untouched.
  if (getSetting("SCENE_SPLIT_MODEL") === "gemini-flash-latest") {
    setSetting("SCENE_SPLIT_MODEL", "gemini-2.5-flash");
  }

  inited = true;
}
