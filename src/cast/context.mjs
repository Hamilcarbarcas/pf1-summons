/**
 * Everything a cast needs, resolved against the use's roll data. DESIGN.md §7.2, §10.
 */

import { MODULE_ID } from "../const.mjs";
import { augmentItems, durationMultiplier } from "../augments.mjs";

const TIMED_UNITS = new Set(["turn", "round", "minute", "hour", "day"]);

async function evaluate(formula, rollData) {
  const roll = await new pf1.dice.RollPF(String(formula), rollData).evaluate();
  return roll.total;
}

/** A number for formulas, the literal text for plain words (`Bear`). §10 */
async function evaluateLoose(value, rollData) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^[A-Za-z][\w\s'-]*$/.test(text) && !/^\d/.test(text)) return text;
  try {
    return await evaluate(text, rollData);
  } catch {
    return text;
  }
}

/** The summoner's token: the use's, else one on the current scene. */
export function summonerTokenOf(actionUse) {
  const token = actionUse.token;
  if (token?.parent === canvas.scene) return token;
  return actionUse.actor?.getActiveTokens(false, true).find((t) => t.parent === canvas.scene) ?? null;
}

async function resolveDuration(cfg, action, rollData) {
  const source = cfg.duration.units ? cfg.duration : action.duration ?? {};
  const units = source.units ?? "";
  if (!TIMED_UNITS.has(units) || !source.value) return { value: null, units };
  try {
    return { value: Math.max(0, Math.floor(await evaluate(source.value, rollData))), units };
  } catch (err) {
    console.error(`${MODULE_ID} | duration formula failed`, source.value, err);
    return { value: null, units };
  }
}

async function resolveRange(cfg, actionUse, rollData) {
  if (cfg.range) {
    try {
      return await evaluate(cfg.range, rollData);
    } catch (err) {
      console.error(`${MODULE_ID} | range formula failed`, cfg.range, err);
    }
  }
  const range = actionUse.shared.templateData?.range;
  return Number.isFinite(range) && range > 0 ? range : null;
}

async function resolveInfo(cfg, actionUse, rollData) {
  const cl = cfg.data.cl ? await evaluateLoose(cfg.data.cl, rollData) : rollData.cl ?? 0;
  const saveDC = cfg.data.saveDC ? await evaluateLoose(cfg.data.saveDC, rollData) : actionUse.shared.saveDC ?? null;
  const info = { cl, sl: rollData.sl ?? null, saveDC };
  for (const row of cfg.data.extra) {
    const name = String(row?.name ?? "").trim();
    if (name) info[name] = await evaluateLoose(row.value, rollData);
  }
  return info;
}

/** A formula's total, 0 when blank or broken. */
async function bonusOf(formula, rollData, label) {
  if (!String(formula ?? "").trim()) return 0;
  try {
    return Math.floor(await evaluate(formula, rollData));
  } catch (err) {
    console.error(`${MODULE_ID} | augment ${label} formula failed`, formula, err);
    return 0;
  }
}

/** Duration: crit-style multiplier, then flat bonuses, in the duration's own units. §9.1 */
async function applyDuration(duration, augments, rollData) {
  if (!Number.isFinite(duration.value)) return duration;
  let value = Math.floor(duration.value * durationMultiplier(augments));
  for (const { augment } of augments) value += await bonusOf(augment.duration.bonus, rollData, "duration");
  return { ...duration, value: Math.max(0, value) };
}

/**
 * An unevaluated quantity roll whose own terms are labeled, so PF1's tooltip shows a name instead of
 * its "undefined" placeholder.
 */
function quantityRoll(formula, rollData) {
  const roll = new pf1.dice.RollPF(formula || "1", rollData);
  const label = game.i18n.localize("PF1SUM.Card.QuantityFlavor");
  for (const term of roll.terms) {
    if (term instanceof foundry.dice.terms.OperatorTerm) continue;
    term.options.flavor ||= label;
  }
  roll.resetFormula();
  return roll;
}

/** Whether a quantity could be more than one: dice, or a fixed number above one. */
function couldBeMultiple(roll) {
  if (!roll.isDeterministic) return true;
  return roll.clone().evaluateSync().total > 1;
}

/**
 * Quantity bonuses become labeled terms on the roll, so the total is the real count and the
 * breakdown names each source. Each bonus goes once, to the first entry it applies to, since it
 * adds to the spell's total. `onlyIfMultiple` (Superior Summoning) needs an entry whose quantity
 * could be more than one.
 */
async function addQuantityBonuses(entries, augments, rollData) {
  const { OperatorTerm, NumericTerm } = foundry.dice.terms;
  for (const { name, augment } of augments) {
    const bonus = await bonusOf(augment.quantity.bonus, rollData, "quantity");
    if (!bonus) continue;
    const target = entries.find((e) => !augment.quantity.onlyIfMultiple || e.multiple);
    if (!target) continue;
    target.roll.terms.push(
      new OperatorTerm({ operator: bonus < 0 ? "-" : "+" }),
      new NumericTerm({ number: Math.abs(bonus), options: { flavor: name } })
    );
    target.roll.resetFormula();
  }
}

/**
 * @param {object} args
 * @param {ActionUse} args.actionUse
 * @param {object} args.cfg            Effective config.
 * @param {object[]} args.entries      Entries chosen for this cast.
 * @param {object[]} [args.augments]   Applied augments (§9).
 */
export async function buildContext({ actionUse, cfg, entries, augments = [] }) {
  const { item, action, actor } = actionUse;
  const rollData = actionUse.shared.rollData ?? actionUse.item.getRollData();
  const summonerToken = summonerTokenOf(actionUse);
  const configItems = cfg.items.filter((r) => r?.name || r?.uuid);

  const ctx = {
    castId: foundry.utils.randomID(),
    cfg,
    item,
    actionId: action.id,
    summoner: actor,
    summonerToken,
    rollMode: actionUse.shared.rollMode ?? game.settings.get("core", "rollMode"),
    duration: await applyDuration(await resolveDuration(cfg, action, rollData), augments, rollData),
    range: await resolveRange(cfg, actionUse, rollData),
    info: await resolveInfo(cfg, actionUse, rollData),
    items: [...configItems, ...augmentItems(augments, configItems)],
    augments: augments.map((a) => a.name),
    entries: [],
    rolls: [],
  };

  for (const entry of entries) {
    const roll = quantityRoll(entry.quantity, rollData);
    ctx.entries.push({ ...entry, roll, multiple: couldBeMultiple(roll) });
  }
  await addQuantityBonuses(ctx.entries, augments, rollData);
  for (const entry of ctx.entries) {
    await entry.roll.evaluate();
    ctx.rolls.push(entry.roll);
    entry.count = Math.max(0, Math.floor(entry.roll.total));
    entry.formula = entry.roll.formula;
  }

  Hooks.callAll(`${MODULE_ID}.duration`, ctx);
  return ctx;
}
