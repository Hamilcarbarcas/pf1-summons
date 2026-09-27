/**
 * Compendium Sources menu. DESIGN.md §6.3.
 *
 * Two ordered lists (Actor and Item compendiums) plus the summon cache. Order is priority: the
 * first enabled compendium holding a name wins. Saved ids of compendiums that are not currently
 * loaded (a disabled module) are kept in place so re-enabling the module restores them.
 */

import { CSS, MODULE_ID, TEMPLATES } from "../const.mjs";
import { KEYS, sources } from "../settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LISTS = [
  { key: "Actor", label: "PF1SUM.Sources.Actors", hint: "PF1SUM.Sources.ActorsHint" },
  { key: "Item", label: "PF1SUM.Sources.Items", hint: "PF1SUM.Sources.ItemsHint" },
];

/** Actors this module imported. §6.1 */
export const cachedActors = () => game.actors.filter((a) => a.getFlag(MODULE_ID, "cached"));

function packageTitle(pack) {
  const { packageType, packageName } = pack.metadata;
  if (packageType === "system") return game.system.title;
  if (packageType === "world") return game.world.title;
  return game.modules.get(packageName)?.title ?? packageName;
}

/** Rows for one list: saved ids first in saved order, then every other pack alphabetically. */
function buildRows(kind) {
  const saved = sources(kind);
  const packs = game.packs.filter((p) => p.documentName === kind);
  const byId = new Map(packs.map((p) => [p.collection, p]));

  const row = (id, enabled) => {
    const pack = byId.get(id);
    return {
      id,
      enabled,
      available: !!pack,
      label: pack?.title ?? id,
      package: pack ? packageTitle(pack) : "",
    };
  };

  const rows = saved.map((id) => row(id, true));
  const rest = packs
    .filter((p) => !saved.includes(p.collection))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => row(p.collection, false));
  return rows.concat(rest);
}

export class SourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-sources`,
    classes: [`${CSS}sources`],
    tag: "form",
    window: {
      title: "PF1SUM.Sources.Title",
      icon: "fa-solid fa-book-atlas",
      contentClasses: ["standard-form"],
    },
    position: { width: 560, height: "auto" },
    form: {
      handler: SourcesConfig.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      moveUp: SourcesConfig.#onMove,
      moveDown: SourcesConfig.#onMove,
      clearCache: SourcesConfig.#onClearCache,
    },
  };

  static PARTS = {
    form: {
      template: `${TEMPLATES}/sources-config.hbs`,
      scrollable: [`.${CSS}sources-lists`],
    },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  /** Working copy, edited in place until submit. */
  draft = null;

  _initializeDraft() {
    this.draft = {
      rows: Object.fromEntries(LISTS.map(({ key }) => [key, buildRows(key)])),
      cacheFolder: game.settings.get(MODULE_ID, KEYS.cacheFolder),
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.draft) this._initializeDraft();
    const cached = cachedActors().length;
    return Object.assign(context, {
      css: CSS,
      lists: LISTS.map((list) => ({ ...list, rows: this.draft.rows[list.key] })),
      cacheFolder: this.draft.cacheFolder,
      cached,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "PF1SUM.Sources.Save" }],
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const box of this.element.querySelectorAll("input[data-source]")) {
      box.addEventListener("change", () => {
        const row = this.draft.rows[box.dataset.list].find((r) => r.id === box.dataset.source);
        if (row) row.enabled = box.checked;
      });
    }
    this.element.querySelector("input[name=cacheFolder]")?.addEventListener("input", (ev) => {
      this.draft.cacheFolder = ev.currentTarget.value;
    });
  }

  static #onMove(event, target) {
    const li = target.closest("[data-id]");
    const rows = this.draft.rows[li.closest("[data-list]").dataset.list];
    const from = rows.findIndex((r) => r.id === li.dataset.id);
    const to = from + (target.dataset.action === "moveUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    this.render({ parts: ["form"] });
  }

  static async #onClearCache() {
    // An unlinked token on any scene still depends on its base actor.
    const inUse = new Set(game.scenes.contents.flatMap((s) => s.tokens.contents.map((t) => t.actorId)));
    const actors = cachedActors();
    const removable = actors.filter((a) => !inUse.has(a.id));
    const skipped = actors.length - removable.length;
    if (!actors.length) return;

    const inUseNote = skipped ? ` ${game.i18n.format("PF1SUM.Sources.InUse", { skipped })}` : "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "PF1SUM.Sources.ClearConfirm.Title" },
      content: `<p>${game.i18n.format("PF1SUM.Sources.ClearConfirm.Body", { count: removable.length })}${inUseNote}</p>`,
    });
    if (!confirmed) return;

    if (removable.length) await Actor.deleteDocuments(removable.map((a) => a.id));
    ui.notifications.info(game.i18n.format("PF1SUM.Sources.Cleared", { count: removable.length }) + inUseNote);
    this.render({ parts: ["form"] });
  }

  static async #onSubmit() {
    for (const { key } of LISTS) {
      const ids = this.draft.rows[key].filter((r) => r.enabled).map((r) => r.id);
      await game.settings.set(MODULE_ID, key === "Actor" ? KEYS.actorSources : KEYS.itemSources, ids);
    }
    const folder = this.draft.cacheFolder.trim();
    if (folder) await game.settings.set(MODULE_ID, KEYS.cacheFolder, folder);
  }
}
