/**
 * Summon buff, dismissal, and combat. DESIGN.md §13.
 */

import { MODULE_ID, CSS } from "./const.mjs";
import { KEYS, flag } from "./settings.mjs";
import { gmRun } from "./socket.mjs";
import { playAt } from "./animation.mjs";

const TIMED_UNITS = new Set(["turn", "round", "minute", "hour", "day"]);

export const markerOf = (token) => token?.flags?.[MODULE_ID]?.summon ?? null;

/** Only the active GM runs automatic dismissals, so they happen once. */
const responsible = () => game.users.activeGM?.isSelf ?? false;

/* -------------------------------------------- */
/*  Summon buff (§13.1)                         */
/* -------------------------------------------- */

/** Generated buff carrying the summon's duration. Expiry or removal dismisses the summon. */
export function summonBuffData(plan) {
  const { value, units } = plan.duration ?? {};
  const timed = Number.isFinite(value) && TIMED_UNITS.has(units);
  return {
    name: game.i18n.format("PF1SUM.Buff.Name", { item: plan.itemName }),
    type: "buff",
    img: plan.itemImg || "icons/magic/symbols/ring-circle-smoke-blue.webp",
    system: {
      subType: "temp",
      active: true,
      level: Number(plan.info?.cl) || 0,
      duration: timed ? { value: String(value), units, end: "initiative" } : { value: "", units: "" },
      description: { value: `<p>${game.i18n.localize("PF1SUM.Buff.Description")}</p>` },
    },
    flags: { [MODULE_ID]: { summonBuff: { castId: plan.castId } } },
  };
}

/* -------------------------------------------- */
/*  Dismissal (§13.2)                           */
/* -------------------------------------------- */

/** RAW 0-HP rule behind one predicate so other rules (ferocity, diehard) can veto. */
export function shouldDismissForHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp || !(hp.value <= 0)) return false;
  return Hooks.call(`${MODULE_ID}.shouldDismiss`, actor, { reason: "hp" }) !== false;
}

/** Whether the current user may dismiss this summon. */
export function canDismiss(token) {
  if (game.user.isGM || token.isOwner) return true;
  const marker = markerOf(token);
  return !!(marker?.summonerActorUuid && fromUuidSync(marker.summonerActorUuid)?.isOwner);
}

const dismissing = new Set();

/**
 * Remove a summon from the scene: animation, combatants, token.
 * @param {TokenDocument} token
 * @param {{reason?: string}} [opts]
 */
export async function dismiss(token, { reason = "manual" } = {}) {
  const marker = markerOf(token);
  if (!marker || dismissing.has(token.uuid)) return false;
  dismissing.add(token.uuid);
  try {
    const center = token.object?.center ?? {
      x: token.x + (token.width * canvas.grid.size) / 2,
      y: token.y + (token.height * canvas.grid.size) / 2,
    };
    if (token.parent === canvas.scene) playAt(marker.dismissAnimation, center);

    for (const combat of game.combats) {
      const ids = combat.combatants
        .filter((c) => c.tokenId === token.id && c.sceneId === token.parent.id)
        .map((c) => c.id);
      if (ids.length) await gmRun("deleteDocuments", { type: "Combatant", ids, parentUuid: combat.uuid });
    }

    const tokenData = token.toObject();
    const deleted = await gmRun("deleteDocuments", { type: "Token", ids: [token.id], parentUuid: token.parent.uuid });
    if (deleted?.length) Hooks.callAll(`${MODULE_ID}.dismissed`, { tokenData, marker, reason });
    return !!deleted?.length;
  } finally {
    dismissing.delete(token.uuid);
  }
}

/** Every summon from one cast, across scenes. */
export function castTokens(castId) {
  return game.scenes.contents.flatMap((s) => s.tokens.filter((t) => markerOf(t)?.castId === castId));
}

export async function dismissCast(castId) {
  for (const token of castTokens(castId)) {
    if (canDismiss(token)) await dismiss(token, { reason: "manual" });
  }
}

/* -------------------------------------------- */
/*  Combat (§13.3)                              */
/* -------------------------------------------- */

/** astora-mod's grouped initiative API, when active. §1.1 */
const groupedInitiative = () => game.astoraMod?.groupInitiative ?? null;

/**
 * Add a summon to the summoner's combat. Inserted right after the summoner (its initiative less
 * 0.001, below PF1's /100 tiebreaker), then joined to the summoner's group when grouped initiative
 * is available: to the group's leader when the summoner is itself a member.
 */
export async function addToCombat(plan, token) {
  if (!plan.combat) return;
  const combat = game.combat;
  if (!combat || combat.combatants.some((c) => c.tokenId === token.id)) return;

  const summoner =
    combat.combatants.find((c) => c.token?.uuid === plan.summonerTokenUuid) ??
    combat.combatants.find((c) => c.actor?.uuid === plan.summonerActorUuid);
  if (!summoner || summoner.initiative == null) return;

  const [uuid] =
    (await gmRun("createDocuments", {
      type: "Combatant",
      parentUuid: combat.uuid,
      data: [
        {
          tokenId: token.id,
          sceneId: token.parent.id,
          actorId: token.actorId,
          initiative: summoner.initiative - 0.001,
          hidden: token.hidden,
        },
      ],
    })) ?? [];

  const gi = groupedInitiative();
  if (!uuid || !gi || !flag(KEYS.groupWithSummoner, true)) return;
  const combatant = await fromUuid(uuid);
  const leader = gi.isMember(summoner) ? gi.leaderOf(summoner) : summoner;
  if (combatant && leader) {
    try {
      await gi.add(leader, [combatant]);
    } catch (err) {
      console.error(`${MODULE_ID} | grouped initiative add failed`, err);
    }
  }
}

/* -------------------------------------------- */
/*  Watchers and HUD                            */
/* -------------------------------------------- */

function onToggleBuff(actor, item, state) {
  if (state || !responsible()) return;
  if (!item.flags?.[MODULE_ID]?.summonBuff) return;
  const token = actor.token;
  if (markerOf(token)) dismiss(token, { reason: "duration" });
}

function onUpdateActor(actor, changed) {
  if (!responsible() || !foundry.utils.hasProperty(changed, "system.attributes.hp")) return;
  const token = actor.token; // unlinked summons only; a linked creature is not sent away at 0 HP
  if (!markerOf(token) || !flag(KEYS.dismissAtZeroHp, true)) return;
  if (shouldDismissForHp(actor)) dismiss(token, { reason: "hp" });
}

function onRenderTokenHUD(hud, html) {
  const token = hud.document;
  if (!markerOf(token) || !canDismiss(token)) return;
  const root = html instanceof HTMLElement ? html : html[0];
  const col = root?.querySelector(".col.right");
  if (!col || col.querySelector(`.${CSS}dismiss`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon ${CSS}dismiss`;
  button.dataset.tooltip = "PF1SUM.Hud.Dismiss";
  button.innerHTML = `<i class="fa-solid fa-person-walking-dashed-line-arrow-right" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hud.close();
    dismiss(token, { reason: "manual" });
  });
  col.append(button);
}

export function registerLifecycleHooks() {
  Hooks.on("pf1ToggleActorBuff", onToggleBuff);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
}
