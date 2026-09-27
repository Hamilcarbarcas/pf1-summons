/**
 * The cast flow. DESIGN.md §7.
 *
 * Selection on new-script-hooks' `pf1PreAttackDialog` when it is active (cancel cancels the use);
 * otherwise at `pf1PostActionUse`. Then context → actors → dice → card → placement loop.
 */

import { MODULE_ID } from "../const.mjs";
import { KEYS, flag } from "../settings.mjs";
import { effectiveConfig } from "../config.mjs";
import { relayAvailable } from "../socket.mjs";
import { resolveActor } from "../resolve.mjs";
import { buildContext } from "./context.mjs";
import { defaultChoice, needsDialog, openSummonDialog } from "../apps/summon-dialog.mjs";
import { collectAugments } from "../augments.mjs";
import { placeOne } from "../placement.mjs";
import { resolvePlanItems, spawnOne } from "../spawn.mjs";
import { animationFor } from "../animation.mjs";
import { animateRolls, attachCard, saveQueue, setResumeHandler } from "../chat/summon-card.mjs";

const DISPOSITION_VALUES = () => ({
  friendly: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
  neutral: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
  hostile: CONST.TOKEN_DISPOSITIONS.HOSTILE,
  secret: CONST.TOKEN_DISPOSITIONS.SECRET,
});

function dispositionFor(mode, ctx) {
  if (mode === "summoner") return ctx.summonerToken?.disposition ?? ctx.summoner?.prototypeToken?.disposition ?? null;
  return DISPOSITION_VALUES()[mode] ?? null;
}

/** Extra ownership granted on the token's delta, or null. §5 */
function ownershipFor(mode, ctx) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  if (mode === "caster") return { [game.user.id]: OWNER };
  if (mode === "summonerOwners") {
    const grant = {};
    for (const [id, level] of Object.entries(ctx.summoner?.ownership ?? {})) {
      if (id !== "default" && level >= OWNER) grant[id] = OWNER;
    }
    return Object.keys(grant).length ? grant : null;
  }
  return null;
}

/** Everything placement and spawning need, serializable onto the card. */
function buildPlan(ctx, queue) {
  const { cfg } = ctx;
  return {
    castId: ctx.castId,
    itemUuid: ctx.item.uuid,
    itemName: ctx.item.name,
    itemImg: ctx.item.img,
    actionId: ctx.actionId,
    summonerActorUuid: ctx.summoner?.uuid ?? null,
    summonerTokenUuid: ctx.summonerToken?.uuid ?? null,
    elevation: ctx.summonerToken?.elevation ?? 0,
    disposition: dispositionFor(cfg.disposition, ctx),
    ownership: ownershipFor(cfg.ownership?.mode, ctx),
    combat: cfg.combat === "add" || (cfg.combat === "default" && flag(KEYS.addToCombat, true)),
    duration: ctx.duration,
    range: ctx.range,
    info: ctx.info,
    items: ctx.items,
    animation: {
      summon: animationFor(cfg.animation.summon, KEYS.summonAnimation),
      dismiss: animationFor(cfg.animation.dismiss, KEYS.dismissAnimation),
    },
    upTo: !!cfg.fixed.upTo,
    queue,
  };
}

/* -------------------------------------------- */
/*  Placement run (§7.3)                        */
/* -------------------------------------------- */

const running = new Set();

/**
 * Place and spawn everything left in the plan's queue. Stops early on right-click / Esc.
 * @param {ChatMessage|null} message
 * @param {object} plan
 */
export async function runPlacement(message, plan) {
  if (running.has(plan.castId)) return;
  running.add(plan.castId);
  try {
    if (!canvas.scene) return void ui.notifications.warn("PF1SUM.Warn.NoScene", { localize: true });
    if (!relayAvailable()) return void ui.notifications.warn("PF1SUM.Relay.NoGM", { localize: true });

    const summonerToken = plan.summonerTokenUuid ? fromUuidSync(plan.summonerTokenUuid) : null;
    const onScene = summonerToken?.parent === canvas.scene ? summonerToken : null;
    if (!onScene) ui.notifications.info("PF1SUM.Place.NoSummoner", { localize: true });

    const items = await resolvePlanItems(plan.items);
    const total = plan.queue.reduce((n, q) => n + q.count, 0);
    const tokens = [];
    let placed = 0;

    outer: for (const entry of plan.queue) {
      const actor = await fromUuid(entry.actorUuid);
      if (!actor) {
        ui.notifications.warn(game.i18n.format("PF1SUM.Warn.ActorMissing", { name: entry.name }));
        entry.count = 0;
        continue;
      }
      // Entry items (a template) go first, then the config's own. §8.3
      const entryItems = [...(await resolvePlanItems(entry.items)), ...items];
      while (entry.count > 0) {
        const label = game.i18n.format("PF1SUM.Place.Label", { name: entry.name, n: placed + 1, total });
        const pos = await placeOne({ actor, summonerToken: onScene, range: plan.range, label });
        if (!pos) break outer;
        const token = await spawnOne(plan, entry, actor, pos, entryItems, message?.id);
        if (token) tokens.push(token);
        entry.count--;
        placed++;
      }
    }

    const queue = plan.upTo ? [] : plan.queue.filter((q) => q.count > 0);
    if (message) await saveQueue(message, queue);
    if (tokens.length) Hooks.callAll(`${MODULE_ID}.summoned`, { plan, tokens });
  } catch (err) {
    console.error(`${MODULE_ID} | placement failed`, err);
  } finally {
    running.delete(plan.castId);
  }
}

setResumeHandler((message) => {
  const plan = foundry.utils.deepClone(message.flags?.[MODULE_ID]?.plan);
  if (plan) return runPlacement(message, plan);
});

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** new-script-hooks: choose before anything is spent. §7.1 */
function onPreAttackDialog(actionUse, promises) {
  const cfg = effectiveConfig(actionUse.item, actionUse.action?.id);
  if (!cfg) return;
  const augments = collectAugments(actionUse.actor, cfg, actionUse.item);
  if (!needsDialog(cfg, augments)) {
    actionUse.shared.pf1Summons = defaultChoice(cfg, augments);
    return;
  }
  if (!Array.isArray(promises)) return;
  const opts = { rollData: actionUse.shared.rollData, summoner: actionUse.actor, augments };
  promises.push(
    openSummonDialog(cfg, actionUse.item, opts).then((choice) => {
      if (choice) actionUse.shared.pf1Summons = choice;
      else actionUse.shared.reject = true;
    })
  );
}

async function onPostUse(actionUse, useMessage) {
  const { item, action } = actionUse;
  const cfg = effectiveConfig(item, action?.id);
  if (!cfg || !["fixed", "list"].includes(cfg.mode)) return;
  if (!canvas.scene) return void ui.notifications.warn("PF1SUM.Warn.NoScene", { localize: true });

  const augments = collectAugments(actionUse.actor, cfg, item);
  let choice = actionUse.shared.pf1Summons;
  if (!choice) {
    const opts = { rollData: actionUse.shared.rollData, summoner: actionUse.actor, augments };
    choice = needsDialog(cfg, augments) ? await openSummonDialog(cfg, item, opts) : defaultChoice(cfg, augments);
    if (!choice) return void ui.notifications.info("PF1SUM.Warn.Cancelled", { localize: true });
  }
  if (!choice.entries?.length) return void ui.notifications.warn("PF1SUM.Warn.NoEntries", { localize: true });
  if (!relayAvailable()) return void ui.notifications.warn("PF1SUM.Relay.NoGM", { localize: true });

  const ids = new Set(choice.augmentIds ?? []);
  const applied = augments.filter((a) => ids.has(a.id));
  const ctx = await buildContext({ actionUse, cfg, entries: choice.entries, augments: applied });
  if (Hooks.call(`${MODULE_ID}.preSummon`, ctx) === false) return;

  const queue = [];
  for (const entry of ctx.entries) {
    const actor = await resolveActor(entry.actor);
    if (!actor) {
      const name = entry.actor?.name || entry.actor?.uuid || "?";
      return void ui.notifications.warn(game.i18n.format("PF1SUM.Warn.ActorNotFound", { name }));
    }
    entry.resolvedName = entry.label ?? actor.name;
    const linked = !!actor.prototypeToken.actorLink;
    // A linked actor is one creature; more than one copy of it is meaningless.
    const count = linked ? Math.min(1, entry.count) : entry.count;
    entry.count = count;
    if (count > 0) {
      const items = (entry.items ?? []).filter((r) => r?.name || r?.uuid);
      queue.push({ actorUuid: actor.uuid, name: entry.resolvedName, linked, count, items });
    }
  }
  if (!queue.length) return void ui.notifications.info("PF1SUM.Warn.NoneRolled", { localize: true });

  const plan = buildPlan(ctx, queue);
  // Dice land before the results appear on the card, as with PF1's own rolls.
  await animateRolls(ctx, useMessage);
  const message = await attachCard(ctx, plan, useMessage);
  await runPlacement(message ?? null, foundry.utils.deepClone(plan));
}

export function registerCastHooks() {
  Hooks.on("pf1PreAttackDialog", onPreAttackDialog);
  Hooks.on("pf1PostActionUse", (actionUse, message) => {
    onPostUse(actionUse, message ?? actionUse.shared?.message ?? null).catch((err) =>
      console.error(`${MODULE_ID} | summon failed`, err)
    );
  });
}
