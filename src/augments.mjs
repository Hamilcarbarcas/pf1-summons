/**
 * Summon augments: config on a source item (feat, class feature, buff) that adjusts summons.
 * DESIGN.md §9.
 *
 * Only items reach the summon itself; quantity, duration and added lists adjust the summoning.
 * Range is deliberately absent: it is read from the use (§7.2).
 */

import { MODULE_ID } from "./const.mjs";
import { nameKey } from "./resolve.mjs";
import { PRESETS } from "./data/augment-presets.mjs";

export const SCOPES = {
  any: "PF1SUM.Augment.Scope.Any",
  families: "PF1SUM.Augment.Scope.Families",
  modes: "PF1SUM.Augment.Scope.Modes",
  items: "PF1SUM.Augment.Scope.Items",
};

export const WHEN = {
  always: "PF1SUM.Augment.When.Always",
  "optional-on": "PF1SUM.Augment.When.OptionalOn",
  "optional-off": "PF1SUM.Augment.When.OptionalOff",
};

export const augmentBase = () => `flags.${MODULE_ID}.augment`;

export function defaultAugment() {
  return {
    enabled: false,
    scope: { kind: "any", families: [], modes: [], items: [] },
    when: "always",
    items: [],
    quantity: { bonus: "", onlyIfMultiple: false },
    duration: { multiplier: 1, bonus: "" },
    lists: { add: [], itemsOnly: false },
  };
}

export function normalizeAugment(raw) {
  const aug = foundry.utils.mergeObject(defaultAugment(), raw ?? {}, { inplace: false });
  for (const key of ["families", "modes", "items"]) if (!Array.isArray(aug.scope[key])) aug.scope[key] = [];
  if (!Array.isArray(aug.items)) aug.items = [];
  if (!Array.isArray(aug.lists.add)) aug.lists.add = [];
  const mult = Number(aug.duration.multiplier);
  aug.duration.multiplier = Number.isFinite(mult) && mult > 0 ? mult : 1;
  return aug;
}

/** The item's own augment config, when stored. */
export const ownAugment = (item) => {
  const raw = item?.flags?.[MODULE_ID]?.augment;
  return raw ? normalizeAugment(raw) : null;
};

/** The built-in preset matching this item, if any. */
export function presetFor(item) {
  if (!item) return null;
  const tag = item.system?.tag;
  const key = nameKey(item.name);
  return PRESETS.find((p) => (tag && p.tags.includes(tag)) || p.names.some((n) => nameKey(n) === key)) ?? null;
}

/** The augment in force on an item: its own when enabled, else a preset unless its own config opts out. */
export function effectiveAugment(item) {
  const own = ownAugment(item);
  if (own) return own.enabled ? own : null;
  const preset = presetFor(item);
  return preset ? normalizeAugment({ ...preset.augment, enabled: true }) : null;
}

/* -------------------------------------------- */
/*  Matching and collection (§9.2)              */
/* -------------------------------------------- */

function refMatches(item, ref) {
  if (!ref) return false;
  if (ref.uuid && (ref.uuid === item.uuid || ref.uuid === item._stats?.compendiumSource)) return true;
  return !!ref.name && nameKey(ref.name) === nameKey(item.name);
}

/** Whether an augment's scope covers a use of `summoningItem` under `cfg`. */
export function scopeMatches(aug, cfg, summoningItem) {
  const { kind, families, modes, items } = aug.scope;
  switch (kind) {
    case "families":
      return cfg.mode === "list" && families.includes(cfg.list.family);
    case "modes":
      return modes.includes(cfg.mode);
    case "items":
      return items.some((ref) => refMatches(summoningItem, ref));
    default:
      return true;
  }
}

/**
 * Augments on the summoner's active items that apply to this summoning.
 * @returns {{id: string, name: string, augment: object, optional: boolean, checked: boolean}[]}
 */
export function collectAugments(actor, cfg, summoningItem) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.isActive === false) continue;
    const aug = effectiveAugment(item);
    if (!aug || !scopeMatches(aug, cfg, summoningItem)) continue;
    out.push({
      id: item.uuid,
      name: item.name,
      sort: item.sort ?? 0,
      augment: aug,
      optional: aug.when !== "always",
      checked: aug.when !== "optional-off",
    });
  }
  return out.sort((a, b) => a.sort - b.sort);
}

/** Ids applied without asking: every mandatory augment and optional ones that default on. */
export const defaultAugmentIds = (augments) => augments.filter((a) => a.checked).map((a) => a.id);

/** Duration multiplier, crit-style: 1 + Σ(m − 1). Three ×2 give ×4. */
export const durationMultiplier = (applied) =>
  1 + applied.reduce((sum, { augment }) => sum + (augment.duration.multiplier - 1), 0);

/** Whether an augment's items go only on summons from the lists it adds. */
export const itemsOnlyAdded = (augment) => !!augment.lists?.itemsOnly && !!augment.lists?.add?.length;

/**
 * Item refs from applied augments, de-duplicated by name. Augments whose items go only on their
 * added lists' summons are skipped; the dialog puts those on the entry.
 */
export function augmentItems(applied, existing = []) {
  const seen = new Set(existing.map((r) => nameKey(r.name)).filter(Boolean));
  const out = [];
  for (const { augment } of applied) {
    if (itemsOnlyAdded(augment)) continue;
    for (const ref of augment.items) {
      const key = nameKey(ref?.name);
      if (!ref || (!key && !ref.uuid) || (key && seen.has(key))) continue;
      if (key) seen.add(key);
      out.push({ name: ref.name ?? "", uuid: ref.uuid ?? null });
    }
  }
  return out;
}
