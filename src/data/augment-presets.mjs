/**
 * Built-in augments for common RAW feats. DESIGN.md §9.4.
 *
 * Matched by identity (`system.tag`, then name), so any version of the feat counts: PF1's, a
 * higher-priority compendium's, or hand-made. An item's own augment config always wins.
 */

export const PRESETS = [
  {
    id: "augment-summoning",
    tags: ["augmentSummoning"],
    names: ["Augment Summoning"],
    augment: { scope: { kind: "any" }, when: "always", items: [{ name: "Augmented Summon", uuid: null }] },
  },
  {
    id: "superior-summoning",
    tags: ["superiorSummoning"],
    names: ["Superior Summoning"],
    augment: { scope: { kind: "any" }, when: "always", quantity: { bonus: "1", onlyIfMultiple: true } },
  },
  {
    id: "extend-spell",
    tags: ["extendSpell"],
    names: ["Extend Spell"],
    augment: { scope: { kind: "any" }, when: "optional-off", duration: { multiplier: 2, bonus: "" } },
  },
];
