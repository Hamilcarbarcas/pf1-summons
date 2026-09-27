/**
 * The summon block on the use's chat card. DESIGN.md §7.2, §20.3.
 *
 * Stored on PF1's own card under `flags.pf1-summons` (`card`: the rendered block, `plan`: the cast
 * plan) and injected at render. Namespaced partial updates can't clobber other modules' flags on
 * the same message. A message of its own is posted only when the use made no card.
 */

import { CSS, MODULE_ID, TEMPLATES } from "../const.mjs";
import { gmRun } from "../socket.mjs";
import { canDismiss, castTokens, dismissCast } from "../lifecycle.mjs";

const remainingOf = (plan) => (plan?.queue ?? []).reduce((n, q) => n + (q.count ?? 0), 0);

function durationLabel(duration) {
  const { value, units } = duration ?? {};
  if (!Number.isFinite(value) || !units) return "";
  const unit = pf1.config.timePeriods?.[units];
  return `${value} ${unit ? game.i18n.localize(unit) : units}`;
}

/** Whisper list and blind flag for a roll mode, as a message would get them. */
function visibility(message, rollMode) {
  if (message) return { whisper: message.whisper?.length ? message.whisper : null, blind: !!message.blind };
  const data = {};
  ChatMessage.applyRollMode(data, rollMode);
  return { whisper: data.whisper?.length ? data.whisper : null, blind: !!data.blind };
}

/**
 * Animate the quantity rolls with Dice So Nice and wait for them to land, as PF1 does for its own
 * action dice. Deterministic quantities have nothing to show.
 */
export async function animateRolls(ctx, message) {
  if (!game.dice3d) return;
  const rolls = ctx.entries.map((e) => e.roll).filter((r) => r && !r.isDeterministic);
  if (!rolls.length) return;
  const { whisper, blind } = visibility(message, ctx.rollMode);
  const speaker = message?.speaker ?? ChatMessage.getSpeaker({ actor: ctx.summoner, token: ctx.summonerToken });
  await Promise.all(rolls.map((roll) => game.dice3d.showForRoll(roll, game.user, true, whisper, blind, null, speaker)));
}

async function renderBlock(ctx, plan, header) {
  const lines = [];
  for (const e of ctx.entries) {
    // Shown when there's something to see: dice, or an augment term added to a fixed quantity.
    const showRoll = e.roll && (!e.roll.isDeterministic || e.roll.terms.length > 1);
    lines.push({
      name: e.resolvedName ?? e.actor?.name ?? "",
      count: e.count,
      // Standard roll display: formula, click-to-expand parts, total.
      rollHtml: showRoll ? await e.roll.render() : "",
    });
  }
  return foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/summon-card.hbs`, {
    css: CSS,
    header,
    itemName: plan.itemName,
    itemImg: plan.itemImg,
    lines,
    duration: durationLabel(plan.duration),
    augments: (ctx.augments ?? []).join(", "),
  });
}

async function updateMessage(message, update) {
  if (message.isOwner) return message.update(update);
  return gmRun("updateDocuments", { type: "ChatMessage", updates: [{ _id: message.id, ...update }] });
}

/**
 * Put the summon block on the use's card, or on a card of its own when the use made none.
 * @param {object} ctx                    Cast context (§7.2).
 * @param {object} plan                   Serializable plan.
 * @param {ChatMessage|null} useMessage   PF1's card for this use.
 * @returns {Promise<ChatMessage|null>}
 */
export async function attachCard(ctx, plan, useMessage) {
  if (useMessage) {
    const html = await renderBlock(ctx, plan, false);
    await updateMessage(useMessage, { [`flags.${MODULE_ID}.card`]: html, [`flags.${MODULE_ID}.plan`]: plan });
    return game.messages.get(useMessage.id) ?? useMessage;
  }

  const html = await renderBlock(ctx, plan, true);
  const data = {
    content: "",
    speaker: ChatMessage.getSpeaker({ actor: ctx.summoner, token: ctx.summonerToken }),
    flags: { [MODULE_ID]: { card: html, plan } },
  };
  ChatMessage.applyRollMode(data, ctx.rollMode);
  return ChatMessage.create(data);
}

/** Store what is left to place. */
export const saveQueue = (message, queue) => updateMessage(message, { [`flags.${MODULE_ID}.plan.queue`]: queue });

const rerender = (message) => ui.chat?.updateMessage?.(message);

/** Resume handler supplied by the cast module, to avoid a circular import. */
let resumeHandler = null;
export const setResumeHandler = (fn) => (resumeHandler = fn);

function button(label, icon, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.innerHTML = `<i class="${icon}" inert></i> ${label}`;
  el.addEventListener("click", async (event) => {
    event.preventDefault();
    el.disabled = true;
    try {
      await onClick();
    } finally {
      el.disabled = false;
    }
  });
  return el;
}

function onRender(message, html) {
  const flags = message.flags?.[MODULE_ID];
  if (!flags?.card || !flags.plan) return;
  if (message.isContentVisible === false) return;
  const root = html.querySelector(".message-content") ?? html;

  const holder = document.createElement("div");
  holder.innerHTML = flags.card;
  const block = holder.firstElementChild;
  if (!block) return;
  root.append(block);

  const plan = flags.plan;
  const bar = block.querySelector(`.${CSS}card-buttons`);
  const remaining = remainingOf(plan);
  if (remaining > 0 && (message.isAuthor || game.user.isGM) && resumeHandler) {
    const label = game.i18n.format("PF1SUM.Card.PlaceRemaining", { count: remaining });
    bar.append(button(label, "fa-solid fa-location-crosshairs", () => resumeHandler(message)));
  }

  const live = castTokens(plan.castId).filter(canDismiss);
  if (live.length) {
    const label = game.i18n.format("PF1SUM.Card.DismissAll", { count: live.length });
    bar.append(
      button(label, "fa-solid fa-person-walking-dashed-line-arrow-right", async () => {
        await dismissCast(plan.castId);
        rerender(message);
      })
    );
  }
}

export function registerCardHooks() {
  Hooks.on("renderChatMessageHTML", onRender);
  // Buttons depend on tokens that live outside the message.
  const refresh = (token) => {
    const marker = token.flags?.[MODULE_ID]?.summon;
    const message = marker?.messageId ? game.messages.get(marker.messageId) : null;
    if (message) rerender(message);
  };
  Hooks.on("createToken", refresh);
  Hooks.on("deleteToken", refresh);
}
