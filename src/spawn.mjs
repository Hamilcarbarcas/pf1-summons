/**
 * Creating a summon's token. DESIGN.md §8.
 *
 * Unlinked: disposition, ownership (on the ActorDelta), elevation, marker, then items on the token's
 * synthetic actor. Linked: the actor's own token placed as-is, or moved if already on the scene.
 */

import { MODULE_ID } from "./const.mjs";
import { gmRun } from "./socket.mjs";
import { resolveItemData } from "./resolve.mjs";
import { addToCombat, summonBuffData } from "./lifecycle.mjs";
import { playAt, SPAWN_DELAY_MS, wait } from "./animation.mjs";

function markerFor(plan, messageId) {
  return {
    summonerActorUuid: plan.summonerActorUuid,
    summonerTokenUuid: plan.summonerTokenUuid,
    itemUuid: plan.itemUuid,
    actionId: plan.actionId,
    messageId: messageId ?? null,
    castId: plan.castId,
    info: plan.info,
    dismissAnimation: plan.animation.dismiss,
  };
}

const centerOf = (pos, actor) => ({
  x: pos.x + (actor.prototypeToken.width * canvas.grid.size) / 2,
  y: pos.y + (actor.prototypeToken.height * canvas.grid.size) / 2,
});

/** Item refs resolved to data. Missing ones warn and are skipped. §8.3 */
export async function resolvePlanItems(refs) {
  const out = [];
  for (const ref of refs ?? []) {
    const data = await resolveItemData(ref);
    if (data) out.push(data);
    else ui.notifications.warn(game.i18n.format("PF1SUM.Warn.ItemMissing", { name: ref.name || ref.uuid }));
  }
  return out;
}

async function animateIn(plan, point) {
  if (playAt(plan.animation.summon, point)) await wait(SPAWN_DELAY_MS);
}

async function spawnLinked(plan, actor, pos, messageId) {
  const scene = canvas.scene;
  const marker = markerFor(plan, messageId);
  const existing = scene.tokens.find((t) => t.actorId === actor.id);

  if (existing) {
    playAt(plan.animation.dismiss, existing.object?.center);
    await animateIn(plan, centerOf(pos, actor));
    const [uuid] =
      (await gmRun("updateDocuments", {
        type: "Token",
        parentUuid: scene.uuid,
        updates: [{ _id: existing.id, x: pos.x, y: pos.y, [`flags.${MODULE_ID}.summon`]: marker }],
        options: { animate: false },
      })) ?? [];
    return uuid ? fromUuid(uuid) : null;
  }

  const doc = await actor.getTokenDocument({ x: pos.x, y: pos.y, flags: { [MODULE_ID]: { summon: marker } } }, { parent: scene });
  await animateIn(plan, centerOf(pos, actor));
  const [uuid] = (await gmRun("createDocuments", { type: "Token", data: [doc.toObject()], parentUuid: scene.uuid })) ?? [];
  return uuid ? fromUuid(uuid) : null;
}

async function spawnUnlinked(plan, actor, pos, items, messageId) {
  const scene = canvas.scene;
  const overrides = {
    x: pos.x,
    y: pos.y,
    elevation: plan.elevation ?? 0,
    flags: { [MODULE_ID]: { summon: markerFor(plan, messageId) } },
  };
  if (plan.disposition !== null && plan.disposition !== undefined) overrides.disposition = plan.disposition;

  const data = (await actor.getTokenDocument(overrides, { parent: scene })).toObject();
  if (plan.ownership) {
    data.delta = { ...(data.delta ?? {}), ownership: { ...actor.ownership, ...plan.ownership } };
  }

  await animateIn(plan, centerOf(pos, actor));
  const [uuid] = (await gmRun("createDocuments", { type: "Token", data: [data], parentUuid: scene.uuid })) ?? [];
  const token = uuid ? await fromUuid(uuid) : null;
  if (!token?.actor) return null;

  const embed = [...items.map((d) => foundry.utils.deepClone(d)), summonBuffData(plan)];
  await gmRun("createDocuments", { type: "Item", data: embed, parentUuid: token.actor.uuid });
  return token;
}

/**
 * @param {object} plan       Serializable cast plan (§7.2).
 * @param {object} entry      Queue entry `{ actorUuid, linked }`.
 * @param {Actor} actor       Resolved world actor.
 * @param {{x: number, y: number}} pos  Footprint top-left.
 * @param {object[]} items    Resolved config item data.
 * @param {string|null} messageId
 * @returns {Promise<TokenDocument|null>}
 */
export async function spawnOne(plan, entry, actor, pos, items, messageId) {
  const token = entry.linked
    ? await spawnLinked(plan, actor, pos, messageId)
    : await spawnUnlinked(plan, actor, pos, items, messageId);
  if (token) await addToCombat(plan, token);
  return token;
}
