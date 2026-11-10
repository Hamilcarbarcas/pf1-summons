/**
 * Placing one summon. DESIGN.md §7.3–7.5.
 *
 * Both paths resolve to the footprint's top-left `{x, y}` snapped to a grid vertex, or null when the
 * user finishes early (right-click / Esc).
 */

import { MODULE_ID } from "./const.mjs";

export const hasSequencer = () => !!(game.modules.get("sequencer")?.active && globalThis.Sequencer?.Crosshair);

/** Footprint geometry for an actor's prototype token. */
function footprint(actor) {
  const { width = 1, height = 1, texture } = actor.prototypeToken;
  const size = canvas.grid.size;
  return { w: width, h: height, px: width * size, py: height * size, img: texture?.src };
}

/** Range measured to the footprint's center gets half the footprint as slack. */
function rangeLimit(range, fp) {
  if (!Number.isFinite(range) || range <= 0) return null;
  return range + (Math.min(fp.w, fp.h) * canvas.grid.distance) / 2;
}

/** The footprint's center, which range, sight and landing height are all measured to. */
const centerOf = (topLeft, fp) => ({ x: topLeft.x + fp.px / 2, y: topLeft.y + fp.py / 2 });

/** pf1-cover-and-sight's answer for a spot, `{ elevation, clear }`, or null when it has none. §7.3 */
function landingAt(token, point, actor) {
  const mod = game.modules.get("pf1-cover-and-sight");
  if (!mod?.active) return null;
  return mod.api?.sightOverWalls?.landing?.(token, point, { actor }) ?? null;
}

/** The placement label, with the height the summon would land at once there is one. §7.3 */
function labelAt(label, landing) {
  if (!landing) return label;
  return game.i18n.format("PF1SUM.Place.LabelElevation", { label, elevation: landing.elevation, units: canvas.grid.units });
}

/**
 * Range and line-of-sight test for a footprint top-left, shared by both paths, with the landing it
 * found there. Always valid when the summoner isn't on the scene (§7.3).
 */
function makeValidator(actor, summonerToken, range, fp) {
  const token = summonerToken?.object ?? null;
  const origin = token?.center ?? null;
  const limit = origin ? rangeLimit(range, fp) : null;
  const isValid = (center, landing) => {
    // Feet to feet. Without a landing height the summon appears at the summoner's elevation, so flat is exact.
    const path = landing
      ? [{ x: origin.x, y: origin.y, elevation: token.document.elevation }, { ...center, elevation: landing.elevation }]
      : [origin, center];
    if (limit !== null && canvas.grid.measurePath(path).distance > limit) return false;
    if (landing) return landing.clear;
    // Wall-height filters walls by the source's token; without one, every wall blocks at any height.
    return !CONFIG.Canvas.polygonBackends.sight.testCollision(origin, center, {
      type: "sight",
      mode: "any",
      source: { object: token, elevation: token.document.elevation },
    });
  };
  return (topLeft) => {
    if (!origin) return { valid: true, landing: null };
    const center = centerOf(topLeft, fp);
    const landing = landingAt(token, center, actor);
    return { valid: isValid(center, landing), landing };
  };
}

/** Range ring around the summoner, or an empty graphic when there's nothing to draw. */
function rangeRing(summonerToken, range) {
  const ring = new PIXI.Graphics();
  ring.eventMode = "none";
  const origin = summonerToken?.object?.center;
  if (origin && Number.isFinite(range) && range > 0) {
    ring.lineStyle(3, 0x33bbff, 0.8).drawCircle(origin.x, origin.y, (range * canvas.grid.size) / canvas.grid.distance);
  }
  canvas.interface.addChild(ring);
  return ring;
}

/**
 * @param {object} args
 * @param {Actor} args.actor
 * @param {TokenDocument|null} args.summonerToken
 * @param {number|null} args.range
 * @param {string} args.label
 * @returns {Promise<{x: number, y: number, elevation?: number}|null>}
 */
export async function placeOne(args) {
  const pos = await (hasSequencer() ? placeWithSequencer(args) : placeWithFallback(args));
  if (!pos) return null;
  const landing = landingAt(args.summonerToken?.object, centerOf(pos, footprint(args.actor)), args.actor);
  return landing ? { ...pos, elevation: landing.elevation } : pos;
}

/* -------------------------------------------- */
/*  Sequencer (§7.4)                            */
/* -------------------------------------------- */

const VALID_COLOR = "#33cc66";
const INVALID_COLOR = "#cc3333";

/**
 * Sequencer's own `limitMaxRange` is not used: its limit branch also rewrites the template's
 * direction to the summoner→cursor angle, which rotates and squashes the footprint rectangle.
 * Range and sight are checked here instead, recoloring the crosshair and refusing invalid clicks.
 */
async function placeWithSequencer({ actor, summonerToken, range, label }) {
  const fp = footprint(actor);
  const dx = fp.w * canvas.grid.distance;
  const dy = fp.h * canvas.grid.distance;
  const check = makeValidator(actor, summonerToken, range, fp);
  const ring = rangeRing(summonerToken, range);
  let valid = true;

  const recolor = (crosshair) => {
    const doc = crosshair?.document;
    if (!doc) return;
    const spot = check({ x: doc.x, y: doc.y });
    valid = spot.valid;
    const color = valid ? VALID_COLOR : INVALID_COLOR;
    doc.updateSource({ fillColor: color, borderColor: color });
    // Sequencer reads the label on each refresh.
    crosshair.crosshair.label.text = labelAt(label, spot.landing);
  };
  const { CALLBACKS } = Sequencer.Crosshair;

  try {
    const result = await Sequencer.Crosshair.show(
      {
        t: CONST.MEASURED_TEMPLATE_TYPES.RECTANGLE,
        distance: Math.hypot(dx, dy),
        direction: Math.toDegrees(Math.atan2(dy, dx)),
        gridHighlight: true,
        icon: { texture: fp.img ?? "", borderVisible: false },
        snap: { position: CONST.GRID_SNAPPING_MODES.VERTEX },
        label: { text: label },
        lockManualRotation: true,
        // Offset applies before snapping, so the returned position is the footprint's top-left.
        location: { offset: { x: -fp.px / 2, y: -fp.py / 2 } },
      },
      {
        [CALLBACKS.SHOW]: (crosshair) => {
          recolor(crosshair);
          crosshair?.refresh();
        },
        [CALLBACKS.MOVE]: recolor,
        [CALLBACKS.PLACED]: () => {
          if (valid) return true;
          ui.notifications.warn("PF1SUM.Place.Invalid", { localize: true });
          return false;
        },
      }
    );
    return result ? { x: result.x, y: result.y } : null;
  } finally {
    ring.destroy();
  }
}

/* -------------------------------------------- */
/*  Fallback aid (§7.5)                         */
/* -------------------------------------------- */

const HIGHLIGHT = `${MODULE_ID}-placement`;
const VALID = 0x33cc66;
const INVALID = 0xcc3333;

function placeWithFallback({ actor, summonerToken, range, label }) {
  return new Promise((resolve) => {
    const fp = footprint(actor);
    const size = canvas.grid.size;
    const check = makeValidator(actor, summonerToken, range, fp);
    const grid = canvas.interface.grid;
    const ring = rangeRing(summonerToken, range);

    const preview = new PIXI.Container();
    const sprite = new PIXI.Sprite();
    sprite.alpha = 0.5;
    const text = new foundry.canvas.containers.PreciseText(label, CONFIG.canvasTextStyle.clone());
    text.anchor.set(0.5, 0);
    text.position.set(fp.px / 2, fp.py + 4);
    preview.addChild(sprite, text);
    preview.eventMode = "none";
    canvas.interface.addChild(preview);
    grid.addHighlightLayer(HIGHLIGHT);

    if (fp.img) {
      foundry.canvas.loadTexture(fp.img).then((tex) => {
        if (!tex || sprite.destroyed) return;
        sprite.texture = tex;
        sprite.width = fp.px;
        sprite.height = fp.py;
      });
    }

    let current = null;

    const onMove = (event) => {
      const p = event.getLocalPosition(canvas.stage);
      const topLeft = canvas.grid.getSnappedPoint(
        { x: p.x - fp.px / 2, y: p.y - fp.py / 2 },
        { mode: CONST.GRID_SNAPPING_MODES.VERTEX }
      );
      const { valid, landing } = check(topLeft);
      current = valid ? topLeft : null;

      preview.position.set(topLeft.x, topLeft.y);
      text.text = labelAt(label, landing);
      sprite.tint = valid ? 0xffffff : 0xff8080;
      grid.clearHighlightLayer(HIGHLIGHT);
      const color = valid ? VALID : INVALID;
      for (let i = 0; i < Math.max(1, fp.w); i++) {
        for (let j = 0; j < Math.max(1, fp.h); j++) {
          grid.highlightPosition(HIGHLIGHT, { x: topLeft.x + i * size, y: topLeft.y + j * size, color, alpha: 0.35 });
        }
      }
    };

    const onDown = (event) => {
      if (event.button === 2) return finish(null);
      if (event.button !== 0) return;
      if (current) finish({ ...current });
      else ui.notifications.warn("PF1SUM.Place.Invalid", { localize: true });
    };

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };

    const tokensInteractive = canvas.tokens.interactiveChildren;
    canvas.tokens.interactiveChildren = false;
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    const teardown = Hooks.once("canvasTearDown", () => finish(null));

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      Hooks.off("canvasTearDown", teardown);
      if (canvas.tokens) canvas.tokens.interactiveChildren = tokensInteractive;
      grid.destroyHighlightLayer(HIGHLIGHT);
      ring.destroy();
      preview.destroy({ children: true });
      resolve(result);
    }
  });
}
