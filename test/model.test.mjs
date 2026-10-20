import assert from "node:assert/strict";
import { test } from "node:test";

import { buildView, formatCountdown, humanDuration, settingTabs, translator } from "../build/model.js";
import { smartStep, snap } from "../build/card.js";
import { DEVICE, ENTITIES, makeHass } from "./fixtures.mjs";

const config = { type: "custom:lumina-card", device: DEVICE };
const NOW = new Date("2026-10-20T15:00:00Z");
const inSeconds = (s) => new Date(NOW.getTime() + s * 1000).toISOString();

test("pièce occupée : phrase, panneaux et ambiance", () => {
  const view = buildView(makeHass(), config, NOW);
  assert.equal(view.status, "ok");
  assert.equal(view.name, "Chambre Parents");
  assert.equal(view.now.text, "Pièce occupée");
  assert.deepEqual(view.panes.map((p) => p.kind), ["lights", "fans"]);
  const [lights, fans] = view.panes;
  assert.equal(lights.level, 70);
  assert.equal(lights.value, "70 %");
  assert.equal(lights.auto, "auto");
  assert.equal(fans.value, "66 %");
  assert.ok(fans.spin > 0);
  assert.equal(view.ambient[0].value, "29,4 °C");
  assert.match(view.ambient[0].detail, /ressentis/);
  assert.equal(view.ticking, false);
});

test("la carte accepte une entité Lumina à la place de l'appareil", () => {
  const view = buildView(makeHass(), { type: "custom:lumina-card", entity: ENTITIES.room_state }, NOW);
  assert.equal(view.status, "ok");
  assert.equal(view.name, "Chambre Parents");
});

test("sans pièce choisie, la carte invite à en choisir une", () => {
  const view = buildView(makeHass(), { type: "custom:lumina-card" }, NOW);
  assert.equal(view.status, "missing");
});

test("contrôle manuel : heure de reprise et bouton pour rendre la main", () => {
  const hass = makeHass({ room: { lights_override_until: inSeconds(1200) } });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.tone, "manual");
  assert.match(view.now.text, /^Lumière en manuel jusqu'à \d\d:\d\d$/);
  assert.equal(view.now.action.kind, "resume");
  assert.equal(view.panes[0].auto, "manual");
});

test("avertissement avant extinction : compte à rebours à la seconde", () => {
  const hass = makeHass({ room: { occupied: false, lights_warning: true, lights_off_at: inSeconds(12) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "La lumière s'éteint dans 12 s");
  assert.equal(view.now.tone, "countdown");
  assert.equal(view.ticking, true);
});

test("confirmation d'absence en cours", () => {
  const hass = makeHass({ room: { vacancy_pending: true, vacancy_at: inSeconds(25) } });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Plus de présence détectée, confirmation dans 25 s");
  assert.equal(view.ticking, true);
});

test("pièce vide : extinctions programmées, la plus proche d'abord", () => {
  const hass = makeHass({ room: { lights_off_at: inSeconds(95), fans_off_at: inSeconds(280) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "La lumière s'éteint dans 1:35");
  assert.deepEqual(view.notes, ["Le ventilateur s'arrête dans 4:40"]);
});

test("automatisme en pause partout : bouton Réactiver", () => {
  const hass = makeHass({
    states: {
      [ENTITIES.auto_lights]: { state: "off", attributes: {} },
      [ENTITIES.auto_fans]: { state: "off", attributes: {} },
    },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Automatisme en pause");
  assert.equal(view.now.action.kind, "enable");
  assert.equal(view.panes[0].auto, "paused");
});

test("présence maintenue par la TV", () => {
  const hass = makeHass({
    room: { presence_hold_active: true },
    states: {
      "binary_sensor.fp2_chambre": { state: "off", attributes: {} },
      "media_player.tv_chambre": { state: "playing", attributes: { friendly_name: "TV Chambre" } },
    },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Présence maintenue par TV Chambre");
});

test("nuit forcée et pas d'allumage la nuit", () => {
  const hass = makeHass({
    room: { period: "night", forced_night: true },
    states: {
      [ENTITIES.forced_night]: { state: "on", attributes: { until: "2026-10-21T10:00:00Z" } },
      [ENTITIES.night_brightness]: { state: "0", attributes: { unit_of_measurement: "%", min: 0, max: 100, step: 1 } },
      "light.chambre": { state: "off", attributes: { supported_color_modes: ["color_temp"] } },
    },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.night, true);
  assert.equal(view.forcedNight, true);
  assert.equal(view.now.tone, "night");
  assert.match(view.notes[0], /^Nuit forcée jusqu'à/);
  assert.equal(view.panes[0].hint, "Pas d'allumage la nuit");
});

test("valeur en cours de glisser affichée avant la réponse", () => {
  const view = buildView(makeHass(), config, NOW, { lights: 25 });
  assert.equal(view.panes[0].level, 25);
  assert.equal(view.panes[0].value, "25 %");
});

test("Lumina indisponible", () => {
  const hass = makeHass();
  hass.states[ENTITIES.room_state].state = "unavailable";
  assert.equal(buildView(hass, config, NOW).status, "unavailable");
});

test("pièce sans ventilateur : un seul panneau, pas d'onglet ventilateur", () => {
  const hass = makeHass({
    room: { fans: [], temperature_sensor: null, humidity_sensor: null },
    states: {
      [ENTITIES.auto_fans]: undefined,
      [ENTITIES.temperature_threshold]: undefined,
      [ENTITIES.fan_min_speed]: undefined,
      [ENTITIES.apparent_temperature]: undefined,
    },
  });
  const view = buildView(hass, config, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["lights"]);
  const tabs = settingTabs(view.entities, translator("fr")).map((tab) => tab.id);
  assert.deepEqual(tabs, ["lights", "night", "presence"]);
});

test("anglais pour les autres langues", () => {
  const view = buildView(makeHass({ language: "de" }), config, NOW);
  assert.equal(view.now.text, "Room occupied");
});

test("formats de durée", () => {
  assert.equal(formatCountdown(9_000), "9 s");
  assert.equal(formatCountdown(95_000), "1:35");
  assert.equal(formatCountdown(3_900_000), "1 h 05");
  const t = translator("fr");
  assert.equal(humanDuration(120, "s", t), "2 min");
  assert.equal(humanDuration(1800, "s", t), "30 min");
  assert.equal(humanDuration(45, "s", t), null);
});

test("pas des réglages adapté à la valeur", () => {
  assert.equal(smartStep(50, 5, 0, 2000), 5); // seuil de luminosité
  assert.equal(smartStep(300, 5, 0, 2000), 50);
  assert.equal(smartStep(120, 10, 0, 3600), 20); // délai en secondes
  assert.equal(smartStep(1800, 60, 0, 14400), 180);
  assert.equal(smartStep(28, 0.5, 18, 35), 0.5); // température : petite plage
  assert.equal(smartStep(2, 1, 0, 100), 1);
});

test("curseur du ventilateur aligné sur ses paliers", () => {
  const view = buildView(makeHass(), config, NOW);
  assert.equal(view.panes[1].step, 33);
  assert.equal(snap(61, 33), 66);
  assert.equal(snap(90, 33), 100);
  assert.equal(snap(10, 33), 0);
  assert.equal(snap(42, 1), 42);
});
