/**
 * Item Hints icons on the actor sheet's item list: one per summon config, one per augment in
 * force. Optional; does nothing without mkah-pf1-item-hints. DESIGN.md §20.8.
 */

import { CSS, MODULE_ID } from "../const.mjs";
import { readActionOverride, readItemConfig } from "../config.mjs";
import { effectiveAugment, ownAugment } from "../augments.mjs";
import { peekRegistry, registry } from "../lists.mjs";
import { summarize } from "./augment-section.mjs";

const SUMMON_ICON = "fa-solid fa-hat-wizard";
const AUGMENT_ICON = "fa-solid fa-wand-sparkles";
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** What a config summons: creature names, else the summon type. */
function describeSummon(cfg, reg) {
  if (cfg.mode === "list") {
    const family = reg?.families.get(cfg.list.family)?.label ?? cfg.list.family;
    return family ? t("PF1SUM.Hint.Summons", { what: family }) : t("PF1SUM.Hint.SummonsBare");
  }
  const names = cfg.fixed.entries.map((e) => e.actor.name).filter(Boolean);
  return names.length ? t("PF1SUM.Hint.Summons", { what: names.join(", ") }) : t("PF1SUM.Hint.SummonsBare");
}

function describeAugment(aug, isPreset, reg) {
  const key = isPreset ? "PF1SUM.Hint.AugmentPreset" : "PF1SUM.Hint.Augment";
  const effects = summarize(aug, reg).join(" ");
  return effects ? `${t(key)}: ${effects}` : t(key);
}

export function registerItemHints() {
  const ih = game.modules.get("mkah-pf1-item-hints");
  if (!ih?.active) return;
  // The handler is synchronous; the registry is cached after first load, so warm it here.
  registry();
  const make = (hint, icon) => ih.api.HintClass.create("", [], { hint, icon });

  ih.api.addHandler((actor, item) => {
    const hints = [];
    const reg = peekRegistry();
    if (!reg) registry();

    const cfg = readItemConfig(item);
    if (cfg.mode) hints.push(make(describeSummon(cfg, reg), SUMMON_ICON));
    for (const actionId of Object.keys(item.flags?.[MODULE_ID]?.actions ?? {})) {
      const own = readActionOverride(item, actionId);
      if (!own?.mode) continue;
      const action = item.actions?.get(actionId)?.name ?? actionId;
      hints.push(make(`${describeSummon(own, reg)} (${action})`, `${SUMMON_ICON} ${CSS}hint-action`));
    }

    const aug = effectiveAugment(item);
    if (aug) hints.push(make(describeAugment(aug, !ownAugment(item), reg), AUGMENT_ICON));
    return hints;
  });
}
