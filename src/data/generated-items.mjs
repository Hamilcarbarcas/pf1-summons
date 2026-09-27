/**
 * Last-resort item definitions, used when no priority compendium has an item of the name.
 * DESIGN.md §9.4, §16. Names are lookup keys and stay unlocalized.
 */

const change = (target, formula, type) => ({ _id: foundry.utils.randomID(8), formula, target, type });

const DEFINITIONS = {
  "Augmented Summon": () => ({
    name: "Augmented Summon",
    type: "buff",
    img: "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    system: {
      subType: "misc",
      active: true,
      changes: [change("str", "4", "enh"), change("con", "4", "enh")],
      description: {
        value: "<p>+4 enhancement bonus to Strength and Constitution from the summoner's Augment Summoning.</p>",
      },
    },
  }),
};

/** Fresh item data for a generated item, or null when none is defined under that name. */
export function generatedItem(name) {
  const key = Object.keys(DEFINITIONS).find((k) => k.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
  return key ? DEFINITIONS[key]() : null;
}

export const generatedItemNames = () => Object.keys(DEFINITIONS);
