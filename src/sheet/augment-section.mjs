/**
 * The Summon Augment section on a source item's Advanced tab. DESIGN.md §9.
 *
 * Three faces: a matching preset (summary, Customize / Turn off), the item's own config (editor),
 * or nothing yet (just the Enabled switch). Shown on feats and buffs, and on anything else once
 * configured.
 */

import { CSS, MODULE_ID, TEMPLATES } from "../const.mjs";
import { MODES } from "../config.mjs";
import {
  SCOPES,
  WHEN,
  augmentBase,
  defaultAugment,
  itemsOnlyAdded,
  normalizeAugment,
  ownAugment,
  presetFor,
} from "../augments.mjs";
import { extraLists, registry } from "../lists.mjs";
import { makeCollapsible } from "../common/sheet/collapse.mjs";
import { bindFields } from "../common/sheet/field-bind.mjs";
import { attachFormulaPreview } from "../common/sheet/formula-preview.mjs";
import { bindRows, refRows } from "./rows.mjs";

const M = `${CSS}augment`;
const SHOWN_TYPES = new Set(["feat", "buff"]);
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const FIELDS = {
  enabled: { type: "checkbox" },
  when: { type: "text" },
  "scope.families": { type: "set" },
  "scope.modes": { type: "set" },
  "quantity.bonus": { type: "text" },
  "quantity.onlyIfMultiple": { type: "checkbox" },
  "duration.multiplier": { type: "number" },
  "duration.bonus": { type: "text" },
  "lists.itemsOnly": { type: "checkbox" },
};

/** One line per effect, for the preset face and the item hint. */
export function summarize(aug, reg) {
  const lines = [];
  const lists = aug.lists.add.map((id) => reg?.lists.get(id)?.label ?? id);
  if (lists.length) lines.push(t("PF1SUM.Augment.Summary.Lists", { lists: lists.join(", ") }));
  const items = aug.items.map((r) => r.name).filter(Boolean);
  const itemsKey = itemsOnlyAdded(aug) ? "ItemsAdded" : "Items";
  if (items.length) lines.push(t(`PF1SUM.Augment.Summary.${itemsKey}`, { items: items.join(", ") }));
  if (aug.quantity.bonus) {
    const key = aug.quantity.onlyIfMultiple ? "QuantityMultiple" : "Quantity";
    lines.push(t(`PF1SUM.Augment.Summary.${key}`, { bonus: aug.quantity.bonus }));
  }
  if (aug.duration.multiplier !== 1) lines.push(t("PF1SUM.Augment.Summary.Multiplier", { mult: aug.duration.multiplier }));
  if (aug.duration.bonus) lines.push(t("PF1SUM.Augment.Summary.DurationBonus", { bonus: aug.duration.bonus }));
  if (aug.when !== "always") lines.push(t("PF1SUM.Augment.Summary.Optional"));
  return lines;
}

function badgeFor(own, preset) {
  if (own) return own.enabled ? t("PF1SUM.Augment.Badge.On") : "";
  return preset ? t("PF1SUM.Augment.Badge.Preset") : "";
}

async function inject(app, html) {
  const item = app.document ?? app.item;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const tab = root?.querySelector('.tab[data-tab="advanced"]');
  if (!item || !tab || tab.querySelector(`.${M}`) || !app.isEditable) return;

  const own = ownAugment(item);
  const preset = presetFor(item);
  if (!own && !preset && !SHOWN_TYPES.has(item.type)) return;

  const reg = await registry();
  if (tab.querySelector(`.${M}`)) return;

  const isPreset = !own && !!preset;
  const aug = own ?? (preset ? normalizeAugment(preset.augment) : defaultAugment());

  const html_ = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/augment-section.hbs`, {
    m: M,
    aug,
    isPreset,
    hasPreset: !!preset,
    presetName: preset ? item.name : "",
    summary: isPreset ? summarize(aug, reg) : [],
    scopes: SCOPES,
    whens: WHEN,
    modes: { fixed: MODES.fixed, list: MODES.list },
    families: Object.fromEntries([...reg.families.values()].map((f) => [f.id, f.label ?? f.id])),
    extraLists: extraLists(reg).map((l) => ({
      id: l.id,
      label: t("PF1SUM.Augment.ListOption", {
        list: l.label ?? l.id,
        family: reg.families.get(l.family)?.label ?? l.family,
      }),
    })),
    scopeFamilies: aug.scope.kind === "families",
    scopeModes: aug.scope.kind === "modes",
    scopeItems: aug.scope.kind === "items",
    scopeRows: refRows(aug.scope.items),
    itemRows: refRows(aug.items),
  });
  const holder = document.createElement("div");
  holder.innerHTML = html_;
  const section = holder.firstElementChild;
  // Inside the body with the other modules' sections, above Little Helper / Item Hints.
  (tab.querySelector(".flexcol") ?? tab).append(section);

  const base = augmentBase();
  const rerender = () => app.render();
  const save = (path, value) => item.update({ [`${base}.${path}`]: value }, { render: false });
  const replace = async (update) => {
    await item.update(update, { render: false });
    rerender();
  };

  for (const el of section.querySelectorAll("[data-pfsum-augment]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const which = el.dataset.pfsumAugment;
      if (which === "customize") replace({ [base]: { ...normalizeAugment(preset.augment), enabled: true } });
      else if (which === "off") replace({ [base]: { ...defaultAugment(), enabled: false } });
      else if (which === "preset") replace({ [`flags.${MODULE_ID}.-=augment`]: null });
    });
  }

  if (!isPreset) {
    const cfg = foundry.utils.deepClone(aug);
    bindFields(section, {
      doc: item,
      base,
      values: foundry.utils.flattenObject(cfg),
      fields: {
        ...FIELDS,
        enabled: { type: "checkbox", onChange: rerender },
        "scope.kind": { type: "text", onChange: rerender },
        // The items-only checkbox shows once a list is added.
        "lists.add": { type: "set", onChange: rerender },
      },
    });
    bindRows(section, { cfg, save, rerender });
    const rollData = item.actor ? item.getRollData() : {};
    for (const input of section.querySelectorAll("input[data-formula]")) attachFormulaPreview(input, rollData);
  }

  makeCollapsible(app, section, {
    key: "augment",
    marker: M,
    configured: !!own?.enabled,
    badge: badgeFor(own, preset),
    // Directly after Summoning, which alphabetical order would put it above.
    sortKey: `${t("PF1SUM.Sheet.Title")} ${t("PF1SUM.Augment.Title")}`,
  });
}

export function registerAugmentSheetHooks() {
  Hooks.on("renderItemSheetPF", (app, html) =>
    inject(app, html).catch((err) => console.error(`${MODULE_ID} | augment section failed`, err))
  );
}
