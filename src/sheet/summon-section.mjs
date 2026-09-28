/**
 * The Summoning section: item Advanced tab and action Misc tab. DESIGN.md §4, §5.
 *
 * Plain fields persist through the kit's `bindFields` without a re-render. Row lists (entries,
 * items, extra data) save the whole array; adding or removing a row re-renders the sheet.
 */

import { CSS, MODULE_ID, TEMPLATES } from "../const.mjs";
import {
  COMBAT_MODES,
  DISPOSITIONS,
  DURATION_UNITS,
  MODES,
  OWNERSHIP_MODES,
  PICKS,
  actionBase,
  itemBase,
  newEntry,
  normalize,
  readActionOverride,
  readItemConfig,
} from "../config.mjs";
import { makeCollapsible } from "../common/sheet/collapse.mjs";
import { bindFields } from "../common/sheet/field-bind.mjs";
import { attachFormulaPreview } from "../common/sheet/formula-preview.mjs";
import { listsFor, registry } from "../lists.mjs";

const M = `${CSS}summon`;
const FALLBACK_IMG = "icons/svg/mystery-man.svg";

const FIELDS = {
  mode: { type: "text" },
  "fixed.pick": { type: "text" },
  "fixed.upTo": { type: "checkbox" },
  skipDialog: { type: "checkbox" },
  "duration.value": { type: "text" },
  "duration.units": { type: "text" },
  range: { type: "text" },
  disposition: { type: "text" },
  "ownership.mode": { type: "text" },
  combat: { type: "text" },
  "data.cl": { type: "text" },
  "data.saveDC": { type: "text" },
  "animation.summon": { type: "text" },
  "animation.dismiss": { type: "text" },
  "list.level": { type: "text" },
  "list.lists": { type: "set" },
};

const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0]);

function badgeFor(cfg, useItem, reg) {
  if (useItem) return game.i18n.localize("PF1SUM.Sheet.ItemBadge");
  if (cfg.mode === "list") return reg?.families.get(cfg.list.family)?.label ?? "";
  if (cfg.mode !== "fixed") return "";
  const entries = cfg.fixed.entries;
  if (entries.length === 1) return entries[0].actor.name || "";
  return entries.length || "";
}

function context(cfg, { isAction, useItem }, reg) {
  const families = Object.fromEntries([...reg.families.values()].map((f) => [f.id, f.label ?? f.id]));
  const familyLists = cfg.list.family
    ? listsFor(reg, cfg.list.family).map((l) => ({ id: l.id, label: l.label ?? l.id }))
    : [];
  return {
    m: M,
    isAction,
    useItem,
    cfg,
    isFixed: cfg.mode === "fixed",
    isList: cfg.mode === "list",
    families,
    familyLists,
    multi: cfg.fixed.entries.length > 1,
    modes: MODES,
    picks: PICKS,
    dispositions: DISPOSITIONS,
    ownerships: OWNERSHIP_MODES,
    combats: COMBAT_MODES,
    units: DURATION_UNITS,
    entries: cfg.fixed.entries.map((e, index) => {
      const doc = e.actor.uuid ? fromUuidSync(e.actor.uuid) : null;
      return {
        index,
        name: e.actor.name,
        uuid: e.actor.uuid,
        img: doc?.img ?? FALLBACK_IMG,
        missing: !!e.actor.uuid && !doc,
        quantity: e.quantity,
      };
    }),
    items: cfg.items.map((r, index) => ({
      index,
      name: r.name,
      uuid: r.uuid ?? null,
      img: r.uuid ? fromUuidSync(r.uuid)?.img ?? null : null,
    })),
    extra: cfg.data.extra.map((r, index) => ({ index, name: r.name ?? "", value: r.value ?? "" })),
  };
}

/** Wire one rendered section. */
function activate({ app, section, item, base, cfg, rollData }) {
  const save = (path, value) => item.update({ [`${base}.${path}`]: value }, { render: false });
  const rerender = () => app.render();

  bindFields(section, {
    doc: item,
    base,
    values: foundry.utils.flattenObject(cfg),
    fields: {
      ...FIELDS,
      mode: { type: "text", onChange: rerender },
      // A new family's lists differ, so the narrowing resets.
      "list.family": { type: "text", onChange: async () => (await save("list.lists", []), rerender()) },
    },
  });

  // Row inputs: rewrite the whole array.
  for (const input of section.querySelectorAll("[data-array]")) {
    input.addEventListener("change", async (event) => {
      event.stopPropagation();
      const path = input.dataset.array;
      const index = Number(input.closest("[data-index]")?.dataset.index);
      const rows = foundry.utils.deepClone(foundry.utils.getProperty(cfg, path) ?? []);
      if (!rows[index]) return;
      foundry.utils.setProperty(rows[index], input.dataset.key, input.value.trim());
      if (input.dataset.key === "actor.name") rows[index].actor.uuid = null;
      foundry.utils.setProperty(cfg, path, rows);
      await save(path, rows);
    });
  }

  for (const input of section.querySelectorAll("input[data-formula]")) {
    attachFormulaPreview(input, rollData);
  }

  const edit = async (path, fn) => {
    const rows = foundry.utils.deepClone(foundry.utils.getProperty(cfg, path) ?? []);
    fn(rows);
    await save(path, rows);
    rerender();
  };
  const indexOf = (el) => Number(el.closest("[data-index]")?.dataset.index);

  const actions = {
    "add-entry": () => edit("fixed.entries", (rows) => rows.push(newEntry())),
    "remove-entry": (el) => edit("fixed.entries", (rows) => rows.splice(indexOf(el), 1)),
    "clear-actor": (el) =>
      edit("fixed.entries", (rows) => {
        const row = rows[indexOf(el)];
        if (row) row.actor.uuid = null;
      }),
    "add-item": () => edit("items", (rows) => rows.push({ name: "", uuid: null })),
    "remove-item": (el) => edit("items", (rows) => rows.splice(indexOf(el), 1)),
    "add-extra": () => edit("data.extra", (rows) => rows.push({ name: "", value: "" })),
    "remove-extra": (el) => edit("data.extra", (rows) => rows.splice(indexOf(el), 1)),
  };

  for (const el of section.querySelectorAll("[data-pfsum-action]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions[el.dataset.pfsumAction]?.(el);
    });
  }

  for (const el of section.querySelectorAll("[data-pfsum-open]")) {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      (await fromUuid(el.dataset.pfsumOpen))?.sheet?.render(true);
    });
  }

  // Drops: an Actor onto a row fills it, onto the list adds one; an Item onto the item list.
  for (const zone of section.querySelectorAll("[data-pfsum-drop]")) {
    zone.addEventListener("dragover", (event) => event.preventDefault());
    zone.addEventListener("drop", async (event) => {
      const kind = zone.dataset.pfsumDrop;
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const wantActor = kind === "entry" || kind === "entries";
      if (data?.type !== (wantActor ? "Actor" : "Item")) return;
      event.preventDefault();
      event.stopPropagation();

      const doc = await fromUuid(data.uuid);
      if (!doc) return;
      const ref = { name: doc.name, uuid: doc.uuid };

      if (kind === "entry") {
        const index = Number(zone.dataset.index);
        await edit("fixed.entries", (rows) => {
          if (rows[index]) rows[index].actor = ref;
        });
      } else if (kind === "entries") {
        await edit("fixed.entries", (rows) => rows.push(newEntry(ref)));
      } else {
        await edit("items", (rows) => rows.push(ref));
      }
    });
  }
}

async function render(cfg, flags, reg) {
  const html = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/summon-section.hbs`, context(cfg, flags, reg));
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.firstElementChild;
}

/** renderItemSheetPF */
async function injectItem(app, html) {
  const item = app.document ?? app.item;
  if (!item || item.system?.actions === undefined) return;
  const root = rootOf(html);
  const tab = root?.querySelector('.tab[data-tab="advanced"]');
  if (!tab || tab.querySelector(`.${M}`) || !app.isEditable) return;

  const cfg = readItemConfig(item);
  const reg = await registry();
  if (tab.querySelector(`.${M}`)) return; // another render finished while awaiting
  const section = await render(cfg, { isAction: false, useItem: false }, reg);
  // Above the Summon Augment section, whichever finishes rendering first.
  const augment = tab.querySelector(`.${CSS}augment`);
  if (augment) augment.before(section);
  else (tab.querySelector(".flexcol") ?? tab).append(section);
  activate({ app, section, item, base: itemBase(), cfg, rollData: item.getRollData() });
  makeCollapsible(app, section, { key: "summon", marker: M, configured: !!cfg.mode, badge: badgeFor(cfg, false, reg) });
}

/** renderItemActionSheet */
async function injectAction(app, html) {
  const action = app.action;
  const item = app.item ?? action?.item;
  if (!action?.id || !item) return;
  const root = rootOf(html);
  const tab = root?.querySelector('.tab[data-tab="misc"]');
  if (!tab || tab.querySelector(`.${M}`) || !app.isEditable) return;

  const override = readActionOverride(item, action.id);
  const useItem = !override;
  const cfg = override ?? normalize({});
  const reg = await registry();
  if (tab.querySelector(`.${M}`)) return;
  const section = await render(cfg, { isAction: true, useItem }, reg);
  tab.append(section);

  section.querySelector("[data-pfsum-use-item]")?.addEventListener("change", async (event) => {
    event.stopPropagation();
    const update = event.currentTarget.checked
      ? { [`flags.${MODULE_ID}.actions.-=${action.id}`]: null }
      : { [actionBase(action.id)]: { ...readItemConfig(item), override: true } };
    await item.update(update, { render: false });
    app.render();
  });

  if (!useItem) {
    activate({ app, section, item, base: actionBase(action.id), cfg, rollData: action.getRollData() });
  }
  const configured = !useItem && !!cfg.mode;
  makeCollapsible(app, section, { key: "summon", marker: M, configured, badge: badgeFor(cfg, useItem, reg) });
}

export function registerSheetHooks() {
  const guard = (fn) => (...args) => fn(...args).catch((err) => console.error(`${MODULE_ID} | sheet section failed`, err));
  Hooks.on("renderItemSheetPF", guard(injectItem));
  // At ready, so the section sits below the Misc tab's other sections.
  Hooks.once("ready", () => Hooks.on("renderItemActionSheet", guard(injectAction)));
}
