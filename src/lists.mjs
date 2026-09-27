/**
 * Families, lists and template groups: shipped data merged with the world overlay. DESIGN.md §11.
 *
 * Overlay sections are arrays keyed by `id`: a matching id replaces the shipped entry, a new id adds
 * one, `{ id, disabled: true }` removes one.
 */

import { MODULE_ID } from "./const.mjs";
import { KEYS } from "./settings.mjs";

export const SECTIONS = ["families", "templateGroups", "lists"];
export const TEMPLATE_RULES = ["alignment", "choose", "fixed"];

const DATA = `modules/${MODULE_ID}/src/data`;

let shipped = null;
let merged = null;

async function fetchJson(path) {
  const response = await fetch(foundry.utils.getRoute(`${DATA}/${path}`));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Shipped data, fetched once. */
export function loadShipped() {
  shipped ??= (async () => {
    const [families, templateGroups, index] = await Promise.all([
      fetchJson("families.json"),
      fetchJson("template-groups.json"),
      fetchJson("lists/index.json"),
    ]);
    const lists = await Promise.all(index.map((file) => fetchJson(`lists/${file}`)));
    return { families, templateGroups, lists };
  })().catch((err) => {
    shipped = null;
    console.error(`${MODULE_ID} | failed to load shipped summon data`, err);
    return { families: [], templateGroups: [], lists: [] };
  });
  return shipped;
}

export const readOverlay = () => game.settings.get(MODULE_ID, KEYS.listOverlay) ?? {};

function mergeSection(base, overlay) {
  const map = new Map((base ?? []).map((x) => [x.id, x]));
  for (const entry of Array.isArray(overlay) ? overlay : []) {
    if (!entry?.id) continue;
    if (entry.disabled) map.delete(entry.id);
    else map.set(entry.id, entry);
  }
  return map;
}

/** `{ families, templateGroups, lists }` as Maps by id. */
export async function registry() {
  if (merged) return merged;
  const base = await loadShipped();
  const overlay = readOverlay();
  merged = Object.fromEntries(SECTIONS.map((s) => [s, mergeSection(base[s], overlay[s])]));
  return merged;
}

function onSetting(setting) {
  if (setting.key === `${MODULE_ID}.${KEYS.listOverlay}`) merged = null;
}

export function registerListHooks() {
  Hooks.on("updateSetting", onSetting);
  Hooks.on("createSetting", onSetting);
  Hooks.once("ready", () => loadShipped());
}

/* -------------------------------------------- */
/*  Rules                                       */
/* -------------------------------------------- */

/** Lists of a family, narrowed to `allowed` ids when any are given. */
export function listsFor(reg, familyId, allowed = []) {
  return [...reg.lists.values()].filter((l) => l.family === familyId && (!allowed?.length || allowed.includes(l.id)));
}

/** Tier levels at or below `level`, highest first. */
export function tiersUpTo(list, level) {
  return Object.keys(list?.tiers ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= level && list.tiers[n]?.length)
    .sort((a, b) => b - a);
}

/** Quantity formula for summoning `diff` levels below the cast level. Keys are exact or `N+`. */
export function quantityFormula(family, diff) {
  const table = family?.quantity ?? {};
  if (table[diff] !== undefined) return String(table[diff]);
  let best = null;
  let bestN = -1;
  for (const [key, value] of Object.entries(table)) {
    const m = /^(\d+)\+$/.exec(key);
    const n = m ? Number(m[1]) : NaN;
    if (n <= diff && n > bestN) {
      best = value;
      bestN = n;
    }
  }
  return String(best ?? "1");
}

/** Good/evil axis of a PF1 alignment code (`lg`, `tn`, `ce`…). */
export function goodEvilAxis(alignment) {
  const code = String(alignment ?? "").toLowerCase();
  if (code.endsWith("g")) return "good";
  if (code.endsWith("e")) return "evil";
  return "neutral";
}

/**
 * Template options the caster may pick from, and the one applied without asking (if any). §11.3
 * @param {object} group      Template group.
 * @param {string} alignment  Summoner's alignment code.
 * @param {string[]} [only]   Option ids an augment narrows the group to (§9.1).
 * @returns {{options: object[], auto: object|null}}
 */
export function templateChoice(group, alignment, only = null) {
  let options = [...(group?.options ?? [])];
  if (only?.length) options = options.filter((o) => only.includes(o.id));
  if (!options.length) return { options: [], auto: null };

  if (group.rule === "fixed") return { options: [options[0]], auto: options[0] };
  if (group.rule === "alignment") {
    const axis = goodEvilAxis(alignment);
    const matching = axis === "neutral" ? options : options.filter((o) => o.alignment === axis);
    if (matching.length) options = matching;
  }
  return { options, auto: options.length === 1 ? options[0] : null };
}

/* -------------------------------------------- */
/*  Overlay validation                          */
/* -------------------------------------------- */

/** Problems with an overlay object, as readable strings. Empty means valid. */
export function validateOverlay(overlay) {
  const errors = [];
  const err = (key, data = {}) => errors.push(game.i18n.format(`PF1SUM.Lists.Error.${key}`, data));
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    err("NotObject");
    return errors;
  }

  const sections = SECTIONS.join(", ");
  for (const key of Object.keys(overlay)) {
    if (!SECTIONS.includes(key)) err("UnknownSection", { key, sections });
  }

  for (const section of SECTIONS) {
    const rows = overlay[section];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      err("NotArray", { section });
      continue;
    }
    rows.forEach((row, i) => {
      const at = `${section}[${i}]`;
      if (!row || typeof row !== "object") return err("RowNotObject", { at });
      if (typeof row.id !== "string" || !row.id) return err("NoId", { at });
      if (row.disabled) return;
      const where = `${at} (${row.id})`;

      if (section === "families" && (typeof row.quantity !== "object" || !row.quantity)) err("Quantity", { where });
      if (section === "templateGroups") {
        if (!TEMPLATE_RULES.includes(row.rule)) err("Rule", { where, rules: TEMPLATE_RULES.join(", ") });
        if (!Array.isArray(row.options) || !row.options.every((o) => o?.id && o?.item)) err("Options", { where });
      }
      if (section === "lists") {
        if (typeof row.family !== "string") err("Family", { where });
        if (!row.tiers || typeof row.tiers !== "object") err("Tiers", { where });
        else {
          for (const [level, entries] of Object.entries(row.tiers)) {
            if (!Array.isArray(entries) || !entries.every((e) => typeof e?.name === "string" && e.name)) {
              err("Tier", { where, level });
            }
          }
        }
      }
    });
  }
  return errors;
}
