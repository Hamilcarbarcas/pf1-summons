/**
 * GM relay. DESIGN.md §12.
 *
 * Generic document primitives only. A GM runs them directly; any other user sends them to the
 * active GM and awaits the result. Results are uuids, since documents do not survive the socket.
 */

import { MODULE_ID } from "./const.mjs";

const CHANNEL = `module.${MODULE_ID}`;
const TIMEOUT_MS = 30_000;

/** @type {Map<string, {resolve: Function, timer: number}>} */
const pending = new Map();

function documentClass(type) {
  const cls = CONFIG[type]?.documentClass;
  if (!cls) throw new Error(`unknown document type "${type}"`);
  return cls;
}

async function resolveParent(parentUuid) {
  if (!parentUuid) return null;
  const parent = await fromUuid(parentUuid);
  if (!parent) throw new Error(`no parent document at "${parentUuid}"`);
  return parent;
}

const HANDLERS = {
  /** args: { type, data: object[], parentUuid?, options? } → created uuids */
  async createDocuments({ type, data, parentUuid, options = {} }) {
    const parent = await resolveParent(parentUuid);
    const docs = await documentClass(type).createDocuments(data, { ...options, parent });
    return docs.map((d) => d.uuid);
  },

  /** args: { type, updates: object[] (each with _id), parentUuid?, options? } → updated uuids */
  async updateDocuments({ type, updates, parentUuid, options = {} }) {
    const parent = await resolveParent(parentUuid);
    const docs = await documentClass(type).updateDocuments(updates, { ...options, parent });
    return docs.map((d) => d.uuid);
  },

  /** args: { type, ids: string[], parentUuid?, options? } → deleted ids */
  async deleteDocuments({ type, ids, parentUuid, options = {} }) {
    const parent = await resolveParent(parentUuid);
    const docs = await documentClass(type).deleteDocuments(ids, { ...options, parent });
    return docs.map((d) => d.id);
  },
};

/**
 * Run a primitive as the GM.
 * @param {"createDocuments"|"updateDocuments"|"deleteDocuments"} fn
 * @param {object} args
 * @returns {Promise<string[]|null>} null on failure, already reported.
 */
export async function gmRun(fn, args) {
  if (!HANDLERS[fn]) {
    console.error(`${MODULE_ID} | relay: unknown primitive "${fn}"`);
    return null;
  }

  if (game.user.isGM) {
    try {
      return await HANDLERS[fn](args);
    } catch (err) {
      console.error(`${MODULE_ID} | relay: ${fn} failed`, err, args);
      ui.notifications.error(game.i18n.format("PF1SUM.Relay.Failed", { error: err.message }));
      return null;
    }
  }

  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("PF1SUM.Relay.NoGM", { localize: true });
    return null;
  }

  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      ui.notifications.warn("PF1SUM.Relay.Timeout", { localize: true });
      resolve(null);
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    game.socket.emit(CHANNEL, { type: "request", fn, args, requestId, gmId: gm.id });
  });
}

/** Whether a relayed step can currently succeed. */
export const relayAvailable = () => game.user.isGM || !!game.users.activeGM;

export function registerSocket() {
  game.socket.on(CHANNEL, async (msg) => {
    if (msg?.type === "response") {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.error) {
        console.error(`${MODULE_ID} | relay: GM reported`, msg.error);
        ui.notifications.error(game.i18n.format("PF1SUM.Relay.Failed", { error: msg.error }));
      }
      entry.resolve(msg.error ? null : msg.result);
      return;
    }

    if (msg?.type !== "request" || msg.gmId !== game.user.id) return;
    const handler = HANDLERS[msg.fn];
    let result = null;
    let error = null;
    try {
      if (!handler) throw new Error(`unknown primitive "${msg.fn}"`);
      result = await handler(msg.args);
    } catch (err) {
      console.error(`${MODULE_ID} | relay: ${msg.fn} failed`, err, msg.args);
      error = err.message ?? String(err);
    }
    game.socket.emit(CHANNEL, { type: "response", requestId: msg.requestId, result, error });
  });
}
