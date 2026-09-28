/**
 * Public API. DESIGN.md §12.1. Exposed as `game.modules.get("pf1-summons").api` and
 * `game.pf1Summons`.
 */

import { castTokens, dismiss, markerOf } from "./lifecycle.mjs";
import { registerResolver, resolveActor } from "./resolve.mjs";
import { registry } from "./lists.mjs";
import { effectiveConfig } from "./config.mjs";
import { collectAugments } from "./augments.mjs";
import { getInfo, setInfo } from "./script-info.mjs";

const tokenDocOf = (t) => (t instanceof foundry.canvas.placeables.Token ? t.document : t);

/** Summon tokens on the current scene whose summoner is this token or actor. */
function getSummons(tokenOrActor) {
  const doc = tokenDocOf(tokenOrActor);
  const tokenUuid = doc instanceof TokenDocument ? doc.uuid : null;
  const actorUuid = doc instanceof TokenDocument ? doc.actor?.uuid : doc?.uuid;
  return (canvas.scene?.tokens ?? []).filter((t) => {
    const m = markerOf(t);
    return m && ((tokenUuid && m.summonerTokenUuid === tokenUuid) || (actorUuid && m.summonerActorUuid === actorUuid));
  });
}

/** The summoner's token, or its actor when the token is gone. */
function getSummoner(token) {
  const m = markerOf(tokenDocOf(token));
  if (!m) return null;
  return (m.summonerTokenUuid && fromUuidSync(m.summonerTokenUuid)) || (m.summonerActorUuid && fromUuidSync(m.summonerActorUuid)) || null;
}

export const api = {
  getSummons,
  getSummoner,
  isSummon: (token) => !!markerOf(tokenDocOf(token)),
  /** A token, or a castId to dismiss every summon of that cast. */
  dismiss: async (tokenOrCastId) => {
    if (typeof tokenOrCastId === "string") {
      for (const t of castTokens(tokenOrCastId)) await dismiss(t);
      return;
    }
    return dismiss(tokenDocOf(tokenOrCastId));
  },
  resolveActor,
  resolvers: { register: registerResolver },
  /** Merged families, template groups and lists, as Maps by id. */
  lists: registry,
  /** Augments that would apply when `actor` uses `item` (default action unless given). */
  augmentsFor: (actor, item, actionId) => {
    const cfg = effectiveConfig(item, actionId ?? item?.defaultAction?.id);
    return cfg ? collectAugments(actor, cfg, item) : [];
  },
  /** `@summonInfo` values from script calls: `setInfo(shared, name, value)`. §10.1 */
  setInfo,
  getInfo,
};
