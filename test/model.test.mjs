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
      [ENTITIES.fans_mode]: undefined,
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

// --- Lumina 0.7 et 0.8 : clims, ventilateurs pendant la clim, nuit -----------

test("clim : troisième panneau avec mode, consigne et comportement en pièce vide", () => {
  const view = buildView(makeHass({ climate: true }), config, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["lights", "fans", "climate"]);
  const climate = view.panes[2];
  assert.equal(climate.on, true);
  assert.equal(climate.value, "Froid");
  assert.equal(climate.mode, "cool");
  assert.deepEqual(climate.setpoint, { value: 24, min: 16, max: 30, step: 0.5 });
  assert.equal(climate.hint, "S'éteint 15 min après ton départ");
  assert.equal(climate.auto, "auto");
  assert.equal(climate.autoEntity, ENTITIES.auto_climate);
});

test("clim éteinte : Lumina ne l'allume jamais, pas de consigne", () => {
  const hass = makeHass({ climate: true, states: { "climate.chambre": { state: "off", attributes: { temperature: 24 } } } });
  const climate = buildView(hass, config, NOW).panes[2];
  assert.equal(climate.on, false);
  assert.equal(climate.value, "Éteinte");
  assert.equal(climate.setpoint, undefined);
  assert.equal(climate.hint, "Lumina ne l'allume jamais");
});

test("clim la nuit sans action : Lumina la laisse tourner", () => {
  const hass = makeHass({ climate: true, room: { period: "night", climate_vacant_action: "none" } });
  assert.equal(buildView(hass, config, NOW).panes[2].hint, "Lumina la laisse tourner la nuit");
});

test("pièce vide : action sur la clim dans le compte à rebours", () => {
  const hass = makeHass({
    climate: true,
    room: { occupied: false, lights_off_at: inSeconds(95), climate_vacant_at: inSeconds(840), climate_vacant_action: "eco" },
  });
  hass.states[ENTITIES.room_state].state = "vacant";
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "La lumière s'éteint dans 1:35");
  assert.deepEqual(view.notes, ["La clim passe en eco dans 14:00"]);
});

test("pièce vide : clim éteinte en ton absence, rétablie au retour", () => {
  const hass = makeHass({
    climate: true,
    room: { occupied: false, climate_vacant_applied: "off" },
    states: { "climate.chambre": { state: "off", attributes: {} } },
  });
  hass.states[ENTITIES.room_state].state = "vacant";
  const view = buildView(hass, config, NOW);
  assert.ok(view.notes.includes("Clim éteinte en ton absence, rétablie à ton retour"));
  assert.equal(view.panes[2].hint, "Rétablie à ton retour");
});

test("contrôle manuel de plusieurs groupes, clim comprise", () => {
  const hass = makeHass({
    climate: true,
    room: { lights_override_until: inSeconds(1200), climate_override_until: inSeconds(600) },
  });
  const view = buildView(hass, config, NOW);
  assert.match(view.now.text, /^Lumière et clim en manuel jusqu'à \d\d:\d\d$/);
  assert.equal(view.panes[2].auto, "manual");
});

test("la nuit, un geste manuel tient jusqu'au matin", () => {
  const morning = new Date(NOW);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(7, 0, 0, 0); // heure de fin de nuit des fixtures
  const hass = makeHass({ room: { period: "night", fans_override_until: morning.toISOString() } });
  const view = buildView(hass, config, NOW);
  assert.match(view.now.text, /^Ventilateur en manuel jusqu'au matin \(07:00\)$/);
  hass.states[ENTITIES.night_override_until_morning].state = "off";
  assert.match(buildView(hass, config, NOW).now.text, /^Ventilateur en manuel jusqu'à 07:00$/);
});

test("Lumina 0.9.2 : chaque groupe garde sa propre échéance la nuit", () => {
  const morning = new Date(NOW);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(7, 0, 0, 0);
  const hass = makeHass({
    room: {
      period: "night",
      lights_override_until: morning.toISOString(),
      fans_override_until: inSeconds(1800),
      overrides_until_morning: ["lights"],
    },
  });
  const view = buildView(hass, config, NOW);
  assert.match(view.now.text, /^Ventilateur en manuel jusqu'à \d\d:\d\d, lumière jusqu'au matin$/);
  assert.equal(view.panes[0].hint, "Manuel jusqu'au matin");
  assert.match(view.panes[1].hint, /^Manuel jusqu'à \d\d:\d\d$/);

  // Lumière seule jusqu'au matin
  hass.states[ENTITIES.room_state].attributes.fans_override_until = null;
  assert.equal(buildView(hass, config, NOW).now.text, "Lumière en manuel jusqu'au matin (07:00)");
});

test("Lumina 0.9.2 : un allumage à l'heure de fin de nuit n'est pas pris pour « jusqu'au matin »", () => {
  const morning = new Date(NOW);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(7, 0, 0, 0);
  const hass = makeHass({
    room: { period: "night", lights_override_until: morning.toISOString(), overrides_until_morning: [] },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Lumière en manuel jusqu'à 07:00");
  assert.equal(view.panes[0].hint, "Manuel jusqu'à 07:00");
});

test("clim en simple ventilation : Lumina ne la touche pas", () => {
  const hass = makeHass({
    climate: true,
    room: { climate_running: false },
    states: { "climate.chambre": { state: "fan_only", attributes: { friendly_name: "Clim chambre" } } },
  });
  const climate = buildView(hass, config, NOW).panes[2];
  assert.equal(climate.value, "Ventilation");
  assert.equal(climate.hint, "En ventilation, Lumina ne la touche pas");
});

test("détecteur indisponible : la note explique que la pièce reste occupée", () => {
  const hass = makeHass({ states: { "binary_sensor.fp2_chambre": { state: "unavailable", attributes: {} } } });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Pièce occupée");
  assert.equal(view.notes[0], "Détecteur indisponible, la pièce reste occupée");

  // Un seul détecteur muet sur deux : rien à signaler
  hass.states[ENTITIES.room_state].attributes.presence_sensors = ["binary_sensor.fp2_chambre", "binary_sensor.pir"];
  hass.states["binary_sensor.pir"] = { entity_id: "binary_sensor.pir", state: "on", attributes: {} };
  assert.deepEqual(buildView(hass, config, NOW).notes, []);

  // Tous muets
  hass.states["binary_sensor.pir"].state = "unknown";
  assert.equal(buildView(hass, config, NOW).notes[0], "Détecteurs indisponibles, la pièce reste occupée");
});

test("ventilateurs pendant la clim : brassage ou arrêt", () => {
  const mix = makeHass({ climate: true, room: { fans_with_climate: "mix" } });
  assert.equal(buildView(mix, config, NOW).panes[1].hint, "Brassage à 33 % pendant la clim");
  const off = makeHass({ climate: true, room: { fans_with_climate: "off" } });
  assert.equal(buildView(off, config, NOW).panes[1].hint, "Arrêté pendant la clim");
  const idle = makeHass({ climate: true, room: { fans_with_climate: "off", climate_running: false } });
  assert.match(buildView(idle, config, NOW).panes[1].hint, /^S'arrête sous/);
});

test("tout en pause, clim comprise : bouton Réactiver", () => {
  const hass = makeHass({
    climate: true,
    states: {
      [ENTITIES.auto_lights]: { state: "off", attributes: {} },
      [ENTITIES.auto_fans]: { state: "off", attributes: {} },
      [ENTITIES.auto_climate]: { state: "off", attributes: {} },
    },
  });
  assert.equal(buildView(hass, config, NOW).now.action.kind, "enable");
  hass.states[ENTITIES.auto_climate].state = "on";
  assert.equal(buildView(hass, config, NOW).now.text, "Pièce occupée");
});

test("réglages : onglet clim, ventilateurs à allumer, contrôle jusqu'au matin", () => {
  const view = buildView(makeHass({ climate: true }), config, NOW);
  const tabs = settingTabs(view.entities, translator("fr"));
  assert.deepEqual(tabs.map((tab) => tab.id), ["lights", "fans", "climate", "night", "presence"]);
  const climate = tabs.find((tab) => tab.id === "climate");
  assert.deepEqual(climate.rows.map((r) => r.key), [
    "auto_climate", "climate_vacant_day", "climate_vacant_night", "climate_vacant_delay", "fans_with_climate", "fan_mix_speed",
  ]);
  assert.equal(climate.rows[1].options.setback, "Modérer");
  const fans = tabs.find((tab) => tab.id === "fans");
  assert.deepEqual(fans.rows.at(-1).options, { all: "Tous", any: "Si aucun allumé" });
  assert.ok(tabs.find((tab) => tab.id === "night").rows.some((r) => r.key === "night_override_until_morning"));
});

test("pièce avec clim seule", () => {
  const hass = makeHass({ climate: true, room: { lights: [], fans: [] } });
  const view = buildView(hass, config, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["climate"]);
  assert.equal(view.now.text, "Pièce occupée");
});
