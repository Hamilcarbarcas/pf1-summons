/**
 * Row lists in injected sections: `{name, uuid}`-style arrays edited in place.
 *
 * Markup contract, all inside `section`:
 * - `[data-array="path"][data-key="field"]` inputs inside `[data-index]` rows: write that field.
 * - `[data-pfsum-add="path"]`: push a blank `{name, uuid}` row.
 * - `[data-pfsum-remove="path"]` inside `[data-index]`: remove that row.
 * - `[data-pfsum-drop-items="path"]`: an Item dropped here is pushed as `{name, uuid}`.
 * - `[data-pfsum-open="uuid"]`: opens the document's sheet.
 */

/**
 * @param {HTMLElement} section
 * @param {object} opts
 * @param {object} opts.cfg                         Live config object, kept in step with saves.
 * @param {(path: string, value: any) => Promise} opts.save
 * @param {() => void} opts.rerender
 */
export function bindRows(section, { cfg, save, rerender }) {
  const rowsAt = (path) => foundry.utils.deepClone(foundry.utils.getProperty(cfg, path) ?? []);
  const indexOf = (el) => Number(el.closest("[data-index]")?.dataset.index);
  const commit = async (path, rows, render) => {
    foundry.utils.setProperty(cfg, path, rows);
    await save(path, rows);
    if (render) rerender();
  };

  for (const input of section.querySelectorAll("[data-array]")) {
    input.addEventListener("change", async (event) => {
      event.stopPropagation();
      const path = input.dataset.array;
      const rows = rowsAt(path);
      const row = rows[indexOf(input)];
      if (!row) return;
      foundry.utils.setProperty(row, input.dataset.key, input.value.trim());
      if (input.dataset.key === "name") row.uuid = null;
      await commit(path, rows, false);
    });
  }

  for (const el of section.querySelectorAll("[data-pfsum-add]")) {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rows = rowsAt(el.dataset.pfsumAdd);
      rows.push({ name: "", uuid: null });
      await commit(el.dataset.pfsumAdd, rows, true);
    });
  }

  for (const el of section.querySelectorAll("[data-pfsum-remove]")) {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rows = rowsAt(el.dataset.pfsumRemove);
      rows.splice(indexOf(el), 1);
      await commit(el.dataset.pfsumRemove, rows, true);
    });
  }

  for (const zone of section.querySelectorAll("[data-pfsum-drop-items]")) {
    zone.addEventListener("dragover", (event) => event.preventDefault());
    zone.addEventListener("drop", async (event) => {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") return;
      event.preventDefault();
      event.stopPropagation();
      const doc = await fromUuid(data.uuid);
      if (!doc) return;
      const path = zone.dataset.pfsumDropItems;
      const rows = rowsAt(path);
      rows.push({ name: doc.name, uuid: doc.uuid });
      await commit(path, rows, true);
    });
  }

  for (const el of section.querySelectorAll("[data-pfsum-open]")) {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      (await fromUuid(el.dataset.pfsumOpen))?.sheet?.render(true);
    });
  }
}

/** Template context for `{name, uuid}` rows. */
export const refRows = (refs) =>
  (refs ?? []).map((r, index) => ({
    index,
    name: r?.name ?? "",
    uuid: r?.uuid ?? null,
    img: r?.uuid ? fromUuidSync(r.uuid)?.img ?? null : null,
  }));
