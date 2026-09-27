/**
 * Actor and item resolution. DESIGN.md §6.
 *
 * Actors: uuid → cached world actor → actor compendiums in priority order → registered resolvers.
 * Compendium actors are imported once into the cache folder. Items: uuid → item compendiums in
 * priority order → built-in definitions.
 */

import { MODULE_ID } from "./const.mjs";
import { KEYS, sources } from "./settings.mjs";
import { gmRun } from "./socket.mjs";
import { generatedItem } from "./data/generated-items.mjs";

/** Case-, space- and punctuation-insensitive name key. */
export const nameKey = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/* -------------------------------------------- */
/*  Registered resolvers (§6.1 step 4)          */
/* -------------------------------------------- */

const resolvers = [];

/**
 * @param {(ref: {name: string, aliases: string[], uuid: string|null}) => Promise<Actor|null>} fn
 * @param {{priority?: number}} [opts]  Lower runs first.
 */
export function registerResolver(fn, { priority = 100 } = {}) {
  resolvers.push({ fn, priority });
  resolvers.sort((a, b) => a.priority - b.priority);
}

/* -------------------------------------------- */
/*  Actors                                      */
/* -------------------------------------------- */

function namesOf(ref) {
  return [ref.name, ...(ref.aliases ?? [])].map(nameKey).filter(Boolean);
}

const findCached = (keys) => game.actors.find((a) => a.getFlag(MODULE_ID, "cached") && keys.includes(nameKey(a.name)));

async function findInPacks(kind, keys) {
  for (const id of sources(kind)) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    if (!pack.visible) {
      console.error(`${MODULE_ID} | compendium "${id}" is hidden from this user; skipped`);
      continue;
    }
    const entry = pack.index.find((e) => keys.includes(nameKey(e.name)));
    if (entry) return pack.getDocument(entry._id);
  }
  return null;
}

/** One pending folder creation, so parallel imports share a folder. */
let folderPromise = null;

async function cacheFolderId() {
  const name = game.settings.get(MODULE_ID, KEYS.cacheFolder);
  const existing = game.folders.find((f) => f.type === "Actor" && f.name === name);
  if (existing) return existing.id;
  folderPromise ??= gmRun("createDocuments", { type: "Folder", data: [{ name, type: "Actor" }] }).finally(() => {
    folderPromise = null;
  });
  const [uuid] = (await folderPromise) ?? [];
  return uuid ? (await fromUuid(uuid))?.id ?? null : null;
}

/** In-flight imports by source uuid, so two summons of one creature import it once. */
const importing = new Map();

async function importActor(source) {
  const key = source.uuid;
  if (importing.has(key)) return importing.get(key);
  const job = (async () => {
    const data = source.toObject();
    delete data._id;
    data.folder = await cacheFolderId();
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.cached`, { source: source.uuid });
    foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
    const [uuid] = (await gmRun("createDocuments", { type: "Actor", data: [data] })) ?? [];
    return uuid ? fromUuid(uuid) : null;
  })().finally(() => importing.delete(key));
  importing.set(key, job);
  return job;
}

/** A world actor for the ref, importing from a compendium if needed. */
async function toWorld(actor) {
  if (!actor) return null;
  if (!actor.pack) return actor;
  const cached = game.actors.find((a) => a.getFlag(MODULE_ID, "cached")?.source === actor.uuid);
  return cached ?? importActor(actor);
}

/**
 * @param {{name?: string, uuid?: string|null, aliases?: string[]}} ref
 * @returns {Promise<Actor|null>} A world actor.
 */
export async function resolveActor(ref) {
  if (ref?.uuid) {
    const doc = await fromUuid(ref.uuid);
    if (doc instanceof Actor) return toWorld(doc);
  }

  const keys = namesOf(ref ?? {});
  if (!keys.length) return null;

  const cached = findCached(keys);
  if (cached) return cached;

  const packed = await findInPacks("Actor", keys);
  if (packed) return toWorld(packed);

  for (const { fn } of resolvers) {
    try {
      const found = await fn({ name: ref.name, aliases: ref.aliases ?? [], uuid: ref.uuid ?? null });
      if (found instanceof Actor) return toWorld(found);
    } catch (err) {
      console.error(`${MODULE_ID} | actor resolver threw`, err);
    }
  }
  return null;
}

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

/**
 * Item data ready to embed, or null.
 * @param {{name?: string, uuid?: string|null}} ref
 */
export async function resolveItemData(ref) {
  let doc = null;
  if (ref?.uuid) {
    const found = await fromUuid(ref.uuid);
    if (found instanceof Item) doc = found;
  }
  if (!doc && ref?.name) doc = await findInPacks("Item", [nameKey(ref.name)]);

  if (doc) {
    const data = doc.toObject();
    delete data._id;
    if (doc.pack) foundry.utils.setProperty(data, "_stats.compendiumSource", doc.uuid);
    return data;
  }
  return ref?.name ? generatedItem(ref.name) : null;
}
