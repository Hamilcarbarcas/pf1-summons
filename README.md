# PF1 Summons

Summoning for Pathfinder 1e, set up entirely from item and action sheets.

**Manifest URL:** `https://github.com/Hamilcarbarcas/pf1-summons/releases/latest/download/module.json`

## Requirements
- Foundry VTT v13
- PF1e system v11.10

## Contents

- [Recommended modules](#recommended-modules)
- [Setup](#setup)
  - [Compendium sources](#compendium-sources)
  - [Configuring a summon](#configuring-a-summon)
  - [Summoning from lists](#summoning-from-lists)
  - [Per action](#per-action)
  - [Editing summon lists](#editing-summon-lists)
  - [Feats that improve summons](#feats-that-improve-summons)
- [Summoning](#summoning)
  - [Passing data to summons](#passing-data-to-summons)
  - [Ending a summon](#ending-a-summon)
  - [Linked creatures](#linked-creatures)
- [Settings](#settings)

## Recommended modules

- **[Sequencer](https://github.com/fantasycalendar/FoundryVTT-Sequencer)**: placement crosshair and
  summon animations. Without it, a simpler placement aid is used and nothing is animated.
- **[PF1 New Script Hooks](https://github.com/Hamilcarbarcas/pf1-new-script-hooks)**: lets
  cancelling the summon menu cancel the spell. Without it, the spell is still used.
- **JB2A** (free or Patreon): the animation files Sequencer plays.
- **[Item Hints](https://gitlab.com/koboldworks/pf1/item-hints)**: shows an icon on items that summon
  (a wizard hat) or carry a Summon Augment (a magic wand) in the character sheet's item lists. Hover
  it for details.

## Setup

### Compendium sources

No creatures ship with this module. Summons are looked up by name in the compendiums you choose.

**Settings → PF1 Summons → Compendium Sources** lists every Actor and Item compendium. Tick the
ones to use and order them; the first one holding a name wins. Put your own compendiums above the
system's to have your versions used.

Compendium actors are copied into a world folder (**Summons** by default) the first time they're
summoned. **Clear cache** in the same menu removes them so they're copied fresh.

### Configuring a summon

On the item's **Advanced** tab, open **Summoning** and set **Summons** to **Specific creatures**.

- **Creatures**: drop actors onto the list, or type names. Each has a quantity formula (`1`, `1d4`,
  `@cl`). With several, choose whether all are summoned or one is picked when used.
- **Quantity is a maximum**: stopping early doesn't leave the rest waiting to be placed.
- **Never ask**: never show the summon dialog.
- **Duration** and **Range**: blank uses the spell's own.
- **Disposition**, **Ownership**, **Combat**: how the summoned tokens are set up.
- **Items added**: items put on every summon. Drop an item or type a name.
- **Data passed to summons**: see [below](#passing-data-to-summons).
- **Animation**: override the default summon and dismiss effects.

### Summoning from lists

For *summon monster*, *summon nature's ally* and the like, set **Summons** to **From summon lists**
and pick the **Summon type**. **Summon level** is the spell's level by default; give a class feature
a formula instead. Tick **Lists** to narrow which lists it draws from; none ticked uses them all.

When used, pick a level (shown with its quantity: 1, 1d3 or 1d4+1), then a creature. Creatures that
take a template get celestial if you're good and fiendish if you're evil; if you're neutral, you choose.
The **Quantity** box starts at the level's quantity; type your own formula to override it.

### Per action

An action's **Misc** tab has its own **Summoning** section. Untick **Use item settings** to give that
action different summons.

### Editing summon lists

**Settings → PF1 Summons → Summon Lists** edits the lists, summon types and templates as JSON, on
top of the shipped ones: an entry with the same `id` replaces it, a new `id` adds one, and
`"disabled": true` removes one. The shipped data is shown below the editor to copy from.

A list with `"extra": true` isn't used on its own; a feat adds it through its Summon Augment (see
below).

### Feats that improve summons

**Augment Summoning**, **Superior Summoning** and **Extend Spell** work on their own: when the
summoner has them, summons get the Augmented Summon buff, one extra creature when several are
summoned, and a doubled duration if you tick Extend Spell when summoning.

Any feat, class feature or buff can do the same through its **Summon Augment** section (Advanced
tab): tick **Affects summons**, then choose what it applies to and what it does. It can add items to
the summons, add creatures, or lengthen the duration. Make it optional
to get a checkbox when summoning. **Customize** on a built-in feat edits its rules; **Turn off**
disables them.

**Added summon lists** puts an extra list's creatures into the summon menu, for feats like Summon Good
Monster. They're marked `*` (a second added list gets `**`), with a key at the bottom of the menu.
Tick **Only on summons from added lists** to give the feat's items only to those creatures.

## Summoning

Use the item as usual. If there's a choice to make, a dialog asks first; with PF1 New Script Hooks,
cancelling it cancels the spell. The quantity is rolled (with Dice So Nice, if you use it), and the
spell's chat card gets a **Summons** section showing the roll and what's being summoned.

Then place each creature on the map within range. Right-click or Esc stops early, and
**Place remaining** on the chat card picks up where you left off.

### Passing data to summons

Summons can read values from the casting: `@summonInfo.cl`, `@summonInfo.sl` and
`@summonInfo.saveDC`, plus any named values you add. For example, a *spiritual weapon* actor can
attack with `@summonInfo.bab + @summonInfo.ablMod` if the spell passes `bab = @attributes.bab.total`
and `ablMod = @ablMod`.

A script call on the item can set values too, which override configured ones with the same name:

```js
game.pf1Summons.setInfo(shared, "bab", actor.system.attributes.bab.total);
```

Use a **Use** or **Post-Use** script call. Values must be numbers or text, and names can't contain
dots. `game.pf1Summons.getInfo(shared)` shows what's been set.

### Ending a summon

Each summon carries a **Summoned** buff with the spell's duration. When it expires or is removed,
the summon leaves. Summons also leave at 0 hit points, from the **Dismiss** button on their token HUD,
and from **Dismiss all** on the chat card.

### Linked creatures

A creature whose token is linked to its actor, such as a paladin's bonded mount, is placed as
itself and moved if it's already on the scene. Nothing on it is changed, and it isn't removed at 0 hit
points.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Summon / dismiss animation | `jb2a.misty_step.01.blue` | Sequencer key or file path; blank for none |
| Dismiss at 0 HP | On | A summoned creature goes away at 0 hit points or lower |
| Add summons to combat | On | Summons join combat right after their summoner |
| Group summons with their summoner | On | With Astora's grouped initiative, summons act on their summoner's turn |
