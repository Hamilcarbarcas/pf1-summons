# Changelog

All notable changes to this module are documented here. Release notes are taken from the section
matching each release tag.

## [Unreleased]

### Added
- **Compendium Sources** settings menu: pick and order the Actor compendiums summoned creatures
  come from and the Item compendiums templates and summon items come from. The first compendium
  holding a name wins.
- Summon cache: compendium actors are imported into a world folder on first use. The folder name is
  configurable, and a **Clear cache** button removes cached actors that no token is using.
- Settings for the summon and dismiss animations, dismissing summons at 0 HP, and adding summons
  to combat.
- **Summoning** section on an item's Advanced tab and an action's Misc tab: summon specific
  creatures (dropped actors or names), with quantity formulas, duration, range, disposition,
  ownership, combat, items added to each summon, data passed to summons, and animations. Actions
  can use the item's settings or their own.
- Using a configured item rolls the quantity (animated with Dice So Nice), adds a **Summons** section
  with the roll to the item's chat card, then places each creature on the map within range
  (Sequencer's crosshair, or a built-in placement aid without it). **Place remaining** on the chat
  card resumes an interrupted placement.
- Summons read casting values as `@summonInfo.cl`, `.sl`, `.saveDC` and any named values configured.
- Summons carry a **Summoned** buff with the duration, and leave when it ends or is removed, at 0 hit
  points, or from the token HUD's **Dismiss** button or the chat card's **Dismiss all**.
- Summons join the active combat right after their summoner.
- Linked creatures (a bonded mount) are placed as themselves, or moved if already on the scene.
- API at `game.pf1Summons` and hooks for other modules.
- **Summoning from lists**: pick a summon type (Summon Monster, Summon Nature's Ally), and when used
  choose a level, which sets the quantity (1, 1d3 or 1d4+1), and a creature. Celestial or fiendish
  templates follow the caster's alignment, and neutral casters choose.
- Summon Monster and Summon Nature's Ally lists for levels 1–9.
- **Summon Lists** settings menu: edit lists, summon types and templates as JSON on top of the
  shipped ones, with import and export.
- With Astora's grouped initiative, summons join their summoner's group and act on its turn.
- **Summon Augment** section on feats, class features and buffs: add items to summons, add
  creatures, lengthen the duration, or limit the template choice, for any summon or chosen ones, always
  or as a checkbox when summoning.
- Augment Summoning, Superior Summoning and Extend Spell work without setup.
- Duration multipliers from several sources combine like critical multipliers.

---

Earlier releases: see [GitHub Releases](https://github.com/Hamilcarbarcas/pf1-summons/releases).
