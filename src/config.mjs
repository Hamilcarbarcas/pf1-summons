/**
 * Summon config model and storage. DESIGN.md §4.2, §5.
 *
 * Item-level config at `flags.pf1-summons.config`; a per-action override at
 * `flags.pf1-summons.actions.<actionId>` with `override: true` (PF1 actions have no flags field).
 */

import { MODULE_ID } from "./const.mjs";

export const MODES = {
  "": "PF1SUM.Sheet.Mode.None",
  fixed: "PF1SUM.Sheet.Mode.Fixed",
  list: "PF1SUM.Sheet.Mode.List",
};

export const PICKS = { all: "PF1SUM.Sheet.Pick.All", one: "PF1SUM.Sheet.Pick.One" };

export const DISPOSITIONS = {
  summoner: "PF1SUM.Sheet.Disposition.Summoner",
  friendly: "TOKEN.DISPOSITION.FRIENDLY",
  neutral: "TOKEN.DISPOSITION.NEUTRAL",
  hostile: "TOKEN.DISPOSITION.HOSTILE",
  secret: "TOKEN.DISPOSITION.SECRET",
};

export const OWNERSHIP_MODES = {
  none: "PF1SUM.Sheet.Ownership.None",
  caster: "PF1SUM.Sheet.Ownership.Caster",
  summonerOwners: "PF1SUM.Sheet.Ownership.SummonerOwners",
};

export const COMBAT_MODES = {
  default: "PF1SUM.Sheet.Combat.Default",
  add: "PF1SUM.Sheet.Combat.Add",
  skip: "PF1SUM.Sheet.Combat.Skip",
};

/** Duration units; blank = the action's own duration. */
export const DURATION_UNITS = {
  "": "PF1SUM.Sheet.Duration.FromAction",
  round: "PF1.Time.Period.round.Label",
  minute: "PF1.Time.Period.minute.Label",
  hour: "PF1.Time.Period.hour.Label",
  day: "PF1.Time.Period.day.Label",
  perm: "PF1.Time.Period.perm.Label",
};

export const itemBase = () => `flags.${MODULE_ID}.config`;
export const actionBase = (actionId) => `flags.${MODULE_ID}.actions.${actionId}`;

export function defaultConfig() {
  return {
    mode: "",
    fixed: { entries: [], pick: "all", upTo: false },
    // Empty `lists` = every list of the family.
    list: { family: "", level: "@sl", lists: [] },
    skipDialog: false,
    duration: { value: "", units: "" },
    range: "",
    disposition: "summoner",
    ownership: { mode: "none" },
    combat: "default",
    items: [],
    data: { cl: "", saveDC: "", extra: [] },
    animation: { summon: "", dismiss: "" },
  };
}

export const newEntry = (actor = {}) => ({
  id: foundry.utils.randomID(8),
  actor: { name: actor.name ?? "", uuid: actor.uuid ?? null },
  quantity: "1",
  linked: !!actor.linked,
});

/** Stored config merged over defaults, arrays guaranteed. */
export function normalize(raw) {
  const cfg = foundry.utils.mergeObject(defaultConfig(), raw ?? {}, { inplace: false, insertKeys: true });
  if (!Array.isArray(cfg.fixed.entries)) cfg.fixed.entries = [];
  cfg.fixed.entries = cfg.fixed.entries.map((e) => foundry.utils.mergeObject(newEntry(), e ?? {}, { inplace: false }));
  if (!Array.isArray(cfg.list.lists)) cfg.list.lists = [];
  if (!Array.isArray(cfg.items)) cfg.items = [];
  if (!Array.isArray(cfg.data.extra)) cfg.data.extra = [];
  delete cfg.override;
  return cfg;
}

export const readItemConfig = (item) => normalize(item?.flags?.[MODULE_ID]?.config);

/** The action's own config when it overrides the item's, else null. */
export function readActionOverride(item, actionId) {
  const raw = item?.flags?.[MODULE_ID]?.actions?.[actionId];
  return raw?.override ? normalize(raw) : null;
}

/** Config governing a use of this action, or null when it doesn't summon. */
export function effectiveConfig(item, actionId) {
  const cfg = readActionOverride(item, actionId) ?? readItemConfig(item);
  return cfg.mode ? cfg : null;
}

/** Drop override keys for actions that no longer exist. */
function pruneOrphans(item, changed) {
  const actions = changed.system?.actions;
  if (!Array.isArray(actions)) return;
  const live = new Set(actions.map((a) => a._id));
  const stored = item.flags?.[MODULE_ID]?.actions ?? {};
  for (const id of Object.keys(stored)) {
    if (!live.has(id)) foundry.utils.setProperty(changed, `flags.${MODULE_ID}.actions.-=${id}`, null);
  }
}

export function registerConfigHooks() {
  Hooks.on("preUpdateItem", (item, changed) => pruneOrphans(item, changed));
}
