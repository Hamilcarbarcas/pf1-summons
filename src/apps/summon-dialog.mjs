/**
 * The Summon dialog. DESIGN.md §7.1.
 *
 * Fixed mode asks only when an entry must be picked. List mode always asks: list, tier, creature,
 * and a template when the group's rule leaves a choice (§11.3). Resolves to `{ entries }` in the
 * shape `buildContext` takes, or null on cancel.
 */

import { CSS, MODULE_ID } from "../const.mjs";
import { listsFor, quantityFormula, registry, templateChoice, tiersUpTo } from "../lists.mjs";
import { defaultAugmentIds, templateNarrowing } from "../augments.mjs";

const esc = foundry.utils.escapeHTML;
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Whether this config needs a dialog at all. Optional augments (§9.3) ask unless `skipDialog`. */
export function needsDialog(cfg, augments = []) {
  if (cfg.mode === "list") return true;
  if (cfg.skipDialog) return false;
  if (augments.some((a) => a.optional)) return true;
  return cfg.mode === "fixed" && cfg.fixed.pick === "one" && cfg.fixed.entries.length > 1;
}

/** Checkboxes for optional augments; empty when there are none. */
function augmentBlock(augments) {
  const optional = augments.filter((a) => a.optional);
  if (!optional.length) return "";
  const boxes = optional
    .map(
      (a) =>
        `<label class="checkbox"><input type="checkbox" name="augment" value="${esc(a.id)}"${a.checked ? " checked" : ""}> ${esc(a.name)}</label>`
    )
    .join("");
  return `<fieldset class="${CSS}dialog-augments"><legend>${t("PF1SUM.Dialog.Augments")}</legend>${boxes}</fieldset>`;
}

/** Applied augment ids: mandatory ones plus the ticked optional ones. */
function appliedIds(form, augments) {
  const ticked = new Set([...form.querySelectorAll('input[name="augment"]:checked')].map((el) => el.value));
  return augments.filter((a) => !a.optional || ticked.has(a.id)).map((a) => a.id);
}

const fixedEntries = (cfg) => cfg.fixed.entries.filter((e) => e.actor?.name || e.actor?.uuid);

/** Entries used when no dialog is shown (fixed mode only). */
export function defaultEntries(cfg) {
  const entries = fixedEntries(cfg);
  return cfg.fixed.pick === "one" ? entries.slice(0, 1) : entries;
}

function wait(item, content, callback, render) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: t("PF1SUM.Dialog.Title", { item: item.name }), icon: "fa-solid fa-hat-wizard" },
    classes: [`${CSS}dialog`],
    content,
    buttons: [
      { action: "summon", label: "PF1SUM.Dialog.Summon", icon: "fa-solid fa-hat-wizard", default: true, callback },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
    ],
    render,
    rejectClose: false,
  });
}

const group = (label, control, attrs = "") =>
  `<div class="form-group" ${attrs}><label>${label}</label><div class="form-fields">${control}</div></div>`;

/* -------------------------------------------- */
/*  Fixed                                       */
/* -------------------------------------------- */

async function openFixedDialog(cfg, item, augments) {
  const pickOne = cfg.fixed.pick === "one" && fixedEntries(cfg).length > 1;
  const entries = fixedEntries(cfg);
  const options = entries
    .map((e) => `<option value="${esc(e.id)}">${esc(e.actor.name || e.actor.uuid)} (${esc(e.quantity || "1")})</option>`)
    .join("");
  const content =
    (pickOne ? group(t("PF1SUM.Dialog.Entry"), `<select name="entry">${options}</select>`) : "") + augmentBlock(augments);

  const result = await wait(item, content, (_event, button) => ({
    entry: button.form.elements.entry?.value ?? null,
    augmentIds: appliedIds(button.form, augments),
  }));
  if (!result || result === "cancel") return null;
  const chosen = pickOne ? entries.filter((e) => e.id === result.entry) : defaultEntries(cfg);
  return chosen.length ? { entries: chosen, augmentIds: result.augmentIds } : null;
}

/* -------------------------------------------- */
/*  List                                        */
/* -------------------------------------------- */

async function castLevel(cfg, family, rollData) {
  try {
    const roll = await new pf1.dice.RollPF(cfg.list.level || "@sl", rollData ?? {}).evaluate();
    return Math.min(Math.floor(roll.total), family.maxLevel ?? Infinity);
  } catch (err) {
    console.error(`${MODULE_ID} | summon level formula failed`, cfg.list.level, err);
    return NaN;
  }
}

async function openListDialog(cfg, item, rollData, summoner, augments) {
  const reg = await registry();
  const family = reg.families.get(cfg.list.family);
  if (!family) return void ui.notifications.warn("PF1SUM.Warn.NoFamily", { localize: true });

  // Stale ids (a list since removed) fall back to every list of the family.
  let lists = listsFor(reg, family.id, cfg.list.lists);
  if (!lists.length) lists = listsFor(reg, family.id);
  if (!lists.length) return void ui.notifications.warn("PF1SUM.Warn.NoLists", { localize: true });

  const level = await castLevel(cfg, family, rollData);
  if (!(level >= 1)) return void ui.notifications.warn(t("PF1SUM.Warn.BadLevel", { level }));
  const alignment = summoner?.system?.details?.alignment ?? "";

  const listOptions = lists.map((l) => `<option value="${esc(l.id)}">${esc(l.label ?? l.id)}</option>`).join("");
  // Inline display, not `hidden`: core's `.form-group { display: flex }` outranks the attribute.
  const HIDE = 'style="display: none"';
  const content = [
    group(t("PF1SUM.Dialog.List"), `<select name="list">${listOptions}</select>`, lists.length > 1 ? "" : HIDE),
    group(t("PF1SUM.Dialog.Tier"), `<select name="tier"></select>`),
    group(t("PF1SUM.Dialog.Creature"), `<select name="creature"></select>`),
    group(t("PF1SUM.Dialog.Template"), `<select name="template"></select>`, `data-template-group ${HIDE}`),
    `<p class="notes" data-template-note ${HIDE}></p>`,
    augmentBlock(augments),
  ].join("");

  // State the callbacks share.
  const pick = { list: null, tier: null, entry: null, choice: null };

  const render = (_event, dialog) => {
    const form = dialog.element.querySelector("form") ?? dialog.element;
    const el = (name) => form.querySelector(`[name="${name}"]`);
    const templateGroupEl = form.querySelector("[data-template-group]");
    const noteEl = form.querySelector("[data-template-note]");

    const fillTemplate = () => {
      const groupDef = pick.entry?.templates ? reg.templateGroups.get(pick.entry.templates) : null;
      const applied = new Set(appliedIds(form, augments));
      const only = templateNarrowing(augments.filter((a) => applied.has(a.id)));
      pick.choice = groupDef ? templateChoice(groupDef, alignment, only[groupDef.id]) : null;
      const opts = pick.choice?.options ?? [];
      const auto = pick.choice?.auto;
      templateGroupEl.style.display = opts.length > 1 ? "" : "none";
      el("template").innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label ?? o.id)}</option>`).join("");
      noteEl.style.display = auto ? "" : "none";
      noteEl.textContent = auto ? t("PF1SUM.Dialog.TemplateApplied", { template: auto.label ?? auto.id }) : "";
    };

    const fillCreatures = () => {
      const entries = pick.list?.tiers?.[pick.tier] ?? [];
      el("creature").innerHTML = entries.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join("");
      pick.entry = entries[0] ?? null;
      fillTemplate();
    };

    const fillTiers = () => {
      const tiers = tiersUpTo(pick.list, level);
      el("tier").innerHTML = tiers
        .map((n) => {
          const quantity = quantityFormula(family, level - n);
          return `<option value="${n}">${esc(t("PF1SUM.Dialog.TierOption", { level: n, quantity }))}</option>`;
        })
        .join("");
      pick.tier = tiers[0] ?? null;
      fillCreatures();
    };

    el("list").addEventListener("change", (ev) => {
      pick.list = lists.find((l) => l.id === ev.currentTarget.value) ?? null;
      fillTiers();
    });
    el("tier").addEventListener("change", (ev) => {
      pick.tier = Number(ev.currentTarget.value);
      fillCreatures();
    });
    el("creature").addEventListener("change", (ev) => {
      pick.entry = pick.list?.tiers?.[pick.tier]?.[Number(ev.currentTarget.value)] ?? null;
      fillTemplate();
    });
    // An augment can narrow the template options (§9.1).
    for (const box of form.querySelectorAll('input[name="augment"]')) box.addEventListener("change", fillTemplate);

    pick.list = lists[0];
    fillTiers();
  };

  const callback = (_event, button) => ({
    template: button.form.elements.template?.value || null,
    augmentIds: appliedIds(button.form, augments),
  });
  const result = await wait(item, content, callback, render);
  if (!result || result === "cancel" || !pick.entry || pick.tier === null) return null;

  const opts = pick.choice?.options ?? [];
  const template = pick.choice?.auto ?? opts.find((o) => o.id === result.template) ?? null;
  const items = [...(template ? [{ name: template.item, uuid: template.uuid ?? null }] : []), ...(pick.entry.items ?? [])];

  return {
    entries: [
      {
        id: foundry.utils.randomID(8),
        actor: { name: pick.entry.name, uuid: pick.entry.uuid ?? null, aliases: pick.entry.aliases ?? [] },
        quantity: quantityFormula(family, level - pick.tier),
        items,
        label: template ? t("PF1SUM.Card.Templated", { name: pick.entry.name, template: template.label ?? template.id }) : null,
      },
    ],
    listId: pick.list.id,
    tier: pick.tier,
    template: template?.id ?? null,
    augmentIds: result.augmentIds,
  };
}

/**
 * @param {object} cfg
 * @param {Item} item
 * @param {{rollData?: object, summoner?: Actor, augments?: object[]}} [opts]
 * @returns {Promise<{entries: object[], augmentIds: string[]}|null>}
 */
export function openSummonDialog(cfg, item, { rollData, summoner, augments = [] } = {}) {
  return cfg.mode === "list"
    ? openListDialog(cfg, item, rollData, summoner, augments)
    : openFixedDialog(cfg, item, augments);
}

/** The choice used when no dialog is shown (fixed mode). */
export const defaultChoice = (cfg, augments = []) => ({
  entries: defaultEntries(cfg),
  augmentIds: defaultAugmentIds(augments),
});
