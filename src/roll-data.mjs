/**
 * `@summonInfo.*` on a summon's roll data. DESIGN.md §10.
 *
 * Actor-level: PF1 builds item and action roll data from the actor's, so every formula on the
 * summon sees it. Unlinked summons only; the values live in the token's marker.
 */

import { MODULE_ID } from "./const.mjs";

function onGetRollData(doc, result) {
  if (!(doc instanceof Actor)) return;
  const info = doc.token?.flags?.[MODULE_ID]?.summon?.info;
  if (info) result.summonInfo = { ...info };
}

export function registerRollData() {
  Hooks.on("pf1GetRollData", onGetRollData);
}
