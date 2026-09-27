/**
 * Summon / dismiss animations through Sequencer when it is active. DESIGN.md §2, §7.2.
 */

import { MODULE_ID } from "./const.mjs";
import { string } from "./settings.mjs";
import { hasSequencer } from "./placement.mjs";

/** Pause between starting a summon effect and creating the token, so it appears mid-effect. */
export const SPAWN_DELAY_MS = 500;

/**
 * Config value → file to play. Blank = the setting's default; "none" = nothing.
 * @param {string} value
 * @param {string} settingKey
 */
export function animationFor(value, settingKey) {
  const v = String(value ?? "").trim();
  if (v.toLowerCase() === "none") return "";
  return v || string(settingKey, "");
}

/** Play an effect at a canvas point. Returns whether anything was started. */
export function playAt(file, point) {
  if (!file || !point || !hasSequencer()) return false;
  try {
    new Sequence().effect().file(file).atLocation(point).play();
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | animation "${file}" failed`, err);
    return false;
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
