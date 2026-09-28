/**
 * `@summonInfo` values set by script calls and hooks during a use. DESIGN.md §10.1.
 */

import { MODULE_ID } from "./const.mjs";

const KEY = "pf1SummonsInfo";

/** An ActionUse's shared data, or the shared data itself. */
const sharedOf = (target) => target?.shared ?? target;

/** Values set on this use so far; empty when none. */
export function scriptInfoOf(target) {
  const shared = sharedOf(target);
  return shared?.[KEY] ?? {};
}

/**
 * Set `@summonInfo.<name>` for the summons of this use. Overrides a configured value of the same name.
 * @param {object} target        `shared` (in a script call) or the ActionUse.
 * @param {string} name
 * @param {number|string} value  Stored as given; only numbers work in `@` math.
 * @returns {boolean} Whether it was set.
 */
export function setInfo(target, name, value) {
  const shared = sharedOf(target);
  if (!shared || typeof shared !== "object") {
    console.error(`${MODULE_ID} | setInfo needs shared or an ActionUse`, target);
    return false;
  }
  const key = String(name ?? "").trim();
  if (!key || key.includes(".")) {
    console.error(`${MODULE_ID} | setInfo name must be non-blank with no dots`, name);
    return false;
  }
  const ok = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
  if (!ok) {
    console.error(`${MODULE_ID} | setInfo value must be a finite number or a string`, key, value);
    return false;
  }
  shared[KEY] ??= {};
  shared[KEY][key] = value;
  return true;
}

/** A copy of the values set on this use so far. Configured values aren't resolved until the cast. */
export function getInfo(target) {
  return { ...scriptInfoOf(target) };
}
