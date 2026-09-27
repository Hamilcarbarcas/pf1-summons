/**
 * Setting registration and a read-through cache. DESIGN.md §17.
 *
 * `game.settings.get` scans every Setting document per call, and some reads here sit on hot hooks
 * (HP dismissal runs on every actor update), so primitives are cached and dropped on any write.
 */

import { MODULE_ID } from "./const.mjs";

export const KEYS = Object.freeze({
  actorSources: "actorSources",
  itemSources: "itemSources",
  cacheFolder: "cacheFolder",
  summonAnimation: "summonAnimation",
  dismissAnimation: "dismissAnimation",
  dismissAtZeroHp: "dismissAtZeroHp",
  addToCombat: "addToCombat",
  groupWithSummoner: "groupWithSummoner",
  listOverlay: "listOverlay",
});

const DEFAULT_ACTOR_SOURCES = ["pf1.basic-monsters"];
const DEFAULT_ITEM_SOURCES = ["pf1.monster-templates", "pf1.template-abilities", "pf1.feats", "pf1.buffs"];
const DEFAULT_ANIMATION = "jb2a.misty_step.01.blue";

export function registerSettings() {
  const world = { scope: "world" };

  game.settings.register(MODULE_ID, KEYS.actorSources, {
    ...world,
    config: false,
    type: Array,
    default: DEFAULT_ACTOR_SOURCES,
  });

  game.settings.register(MODULE_ID, KEYS.itemSources, {
    ...world,
    config: false,
    type: Array,
    default: DEFAULT_ITEM_SOURCES,
  });

  game.settings.register(MODULE_ID, KEYS.cacheFolder, {
    ...world,
    config: false,
    type: String,
    default: "Summons",
  });

  game.settings.register(MODULE_ID, KEYS.summonAnimation, {
    ...world,
    name: "PF1SUM.Settings.SummonAnimation.Name",
    hint: "PF1SUM.Settings.SummonAnimation.Hint",
    config: true,
    type: String,
    default: DEFAULT_ANIMATION,
  });

  game.settings.register(MODULE_ID, KEYS.dismissAnimation, {
    ...world,
    name: "PF1SUM.Settings.DismissAnimation.Name",
    hint: "PF1SUM.Settings.DismissAnimation.Hint",
    config: true,
    type: String,
    default: DEFAULT_ANIMATION,
  });

  game.settings.register(MODULE_ID, KEYS.dismissAtZeroHp, {
    ...world,
    name: "PF1SUM.Settings.DismissAtZeroHp.Name",
    hint: "PF1SUM.Settings.DismissAtZeroHp.Hint",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, KEYS.addToCombat, {
    ...world,
    name: "PF1SUM.Settings.AddToCombat.Name",
    hint: "PF1SUM.Settings.AddToCombat.Hint",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, KEYS.groupWithSummoner, {
    ...world,
    name: "PF1SUM.Settings.GroupWithSummoner.Name",
    hint: "PF1SUM.Settings.GroupWithSummoner.Hint",
    config: true,
    type: Boolean,
    default: true,
  });

  // §11.1: user edits layered over the shipped lists, edited through its own menu.
  game.settings.register(MODULE_ID, KEYS.listOverlay, {
    ...world,
    config: false,
    type: Object,
    default: {},
  });

  Hooks.on("updateSetting", invalidate);
  Hooks.on("createSetting", invalidate);
}

/* -------------------------------------------- */
/*  Cached reads                                */
/* -------------------------------------------- */

const cache = new Map();

function invalidate() {
  cache.clear();
}

/** Primitive settings only: a cached object would be shared by reference. */
function read(key, fallback) {
  if (cache.has(key)) return cache.get(key);
  let value;
  try {
    value = game.settings.get(MODULE_ID, key);
  } catch {
    // Not registered yet; never cache the fallback.
    return fallback;
  }
  cache.set(key, value);
  return value;
}

export const flag = (key, fallback = false) => read(key, fallback) === true;
export const string = (key, fallback = "") => {
  const value = read(key, fallback);
  return typeof value === "string" ? value : fallback;
};

/** Ordered compendium ids; a fresh copy each call. */
export function sources(kind) {
  const key = kind === "Actor" ? KEYS.actorSources : KEYS.itemSources;
  const value = game.settings.get(MODULE_ID, key);
  return Array.isArray(value) ? [...value] : [];
}
