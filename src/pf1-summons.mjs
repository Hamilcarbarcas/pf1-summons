import { MODULE_ID } from "./const.mjs";
import { registerSettings } from "./settings.mjs";
import { registerSocket } from "./socket.mjs";
import { registerConfigHooks } from "./config.mjs";
import { registerSheetHooks } from "./sheet/summon-section.mjs";
import { registerAugmentSheetHooks } from "./sheet/augment-section.mjs";
import { registerItemHints } from "./sheet/item-hints.mjs";
import { registerCastHooks } from "./cast/cast.mjs";
import { registerLifecycleHooks } from "./lifecycle.mjs";
import { registerRollData } from "./roll-data.mjs";
import { registerCardHooks } from "./chat/summon-card.mjs";
import { registerListHooks } from "./lists.mjs";
import { SourcesConfig } from "./apps/sources-config.mjs";
import { ListsConfig } from "./apps/lists-config.mjs";
import { api } from "./api.mjs";

Hooks.once("init", () => {
  registerSettings();

  game.settings.registerMenu(MODULE_ID, "sources", {
    name: "PF1SUM.Settings.Sources.Name",
    label: "PF1SUM.Settings.Sources.Label",
    hint: "PF1SUM.Settings.Sources.Hint",
    icon: "fa-solid fa-book-atlas",
    type: SourcesConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "lists", {
    name: "PF1SUM.Settings.Lists.Name",
    label: "PF1SUM.Settings.Lists.Label",
    hint: "PF1SUM.Settings.Lists.Hint",
    icon: "fa-solid fa-list",
    type: ListsConfig,
    restricted: true,
  });

  registerSocket();
  registerListHooks();
  registerConfigHooks();
  registerSheetHooks();
  registerAugmentSheetHooks();
  registerCastHooks();
  registerLifecycleHooks();
  registerRollData();
  registerCardHooks();

  game.modules.get(MODULE_ID).api = api;
  game.pf1Summons = api;
});

Hooks.once("ready", () => registerItemHints());
