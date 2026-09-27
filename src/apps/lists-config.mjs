/**
 * Summon Lists menu: a JSON editor for the world overlay. DESIGN.md §11.1.
 */

import { CSS, MODULE_ID, TEMPLATES } from "../const.mjs";
import { KEYS } from "../settings.mjs";
import { loadShipped, readOverlay, validateOverlay } from "../lists.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const pretty = (obj) => JSON.stringify(obj ?? {}, null, 2);

export class ListsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-lists`,
    classes: [`${CSS}lists`],
    tag: "form",
    window: {
      title: "PF1SUM.Lists.Title",
      icon: "fa-solid fa-list",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: { width: 720, height: 680 },
    form: { handler: ListsConfig.#onSubmit, closeOnSubmit: false },
    actions: {
      exportOverlay: ListsConfig.#onExport,
      importOverlay: ListsConfig.#onImport,
      resetOverlay: ListsConfig.#onReset,
    },
  };

  static PARTS = {
    form: { template: `${TEMPLATES}/lists-config.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  /** Editor text kept across re-renders; null means "load from the setting". */
  draftText = null;
  errors = [];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const shipped = await loadShipped();
    return Object.assign(context, {
      css: CSS,
      text: this.draftText ?? pretty(readOverlay()),
      shipped: pretty(shipped),
      errors: this.errors,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "PF1SUM.Lists.Save" }],
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("textarea[name=overlay]")?.addEventListener("input", (ev) => {
      this.draftText = ev.currentTarget.value;
    });
  }

  #showErrors(errors) {
    this.errors = errors;
    this.render({ parts: ["form"] });
  }

  /** Parsed overlay from the editor, or null with errors shown. */
  #parse(text) {
    let overlay;
    try {
      overlay = JSON.parse(text.trim() || "{}");
    } catch (err) {
      this.#showErrors([game.i18n.format("PF1SUM.Lists.Error.Json", { error: err.message })]);
      return null;
    }
    const errors = validateOverlay(overlay);
    if (errors.length) {
      this.#showErrors(errors);
      return null;
    }
    return overlay;
  }

  static async #onSubmit(event, form, formData) {
    const text = formData.object.overlay ?? "";
    this.draftText = text;
    const overlay = this.#parse(text);
    if (!overlay) return;
    await game.settings.set(MODULE_ID, KEYS.listOverlay, overlay);
    ui.notifications.info("PF1SUM.Lists.Saved", { localize: true });
    this.close();
  }

  static #onExport() {
    const text = this.draftText ?? pretty(readOverlay());
    foundry.utils.saveDataToFile(text, "application/json", "pf1-summons-lists.json");
  }

  static #onImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.draftText = await foundry.utils.readTextFromFile(file);
      if (!this.#parse(this.draftText)) return;
      this.errors = [];
      this.render({ parts: ["form"] });
    });
    input.click();
  }

  static async #onReset() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "PF1SUM.Lists.ResetConfirm.Title" },
      content: `<p>${game.i18n.localize("PF1SUM.Lists.ResetConfirm.Body")}</p>`,
    });
    if (!confirmed) return;
    this.draftText = "{}";
    this.errors = [];
    this.render({ parts: ["form"] });
  }
}
