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

  inited = true;
}
