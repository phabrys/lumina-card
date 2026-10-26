import assert from "node:assert/strict";
import { test } from "node:test";

import { buildView, formatCountdown, formatDelay, formatDuration, resolveRoom, settingTabs, translator } from "../build/model.js";
import { durationStep, smartStep, snap, tickKey } from "../build/card.js";
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
  const hass = makeHass({ room: { occupied: false, lights_off_at: inSeconds(95), fans_off_at: inSeconds(280) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "La lumière s'éteint dans 1:35");
  assert.deepEqual(view.notes, ["Le ventilateur s'arrête dans 4:40"]);
});

test("compte à rebours : d'une seconde à l'autre, seuls les textes changent", () => {
  const hass = makeHass({ room: { occupied: false, lights_off_at: inSeconds(95), fans_off_at: inSeconds(280) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  const before = buildView(hass, config, NOW);
  const after = buildView(hass, config, new Date(NOW.getTime() + 1000));
  assert.equal(after.now.text, "La lumière s'éteint dans 1:34");
  assert.deepEqual(after.notes, ["Le ventilateur s'arrête dans 4:39"]);
  assert.equal(tickKey(after), tickKey(before));
  // L'avertissement change le ton et l'icône de la phrase : il faut redessiner
  hass.states[ENTITIES.room_state].attributes.lights_warning = true;
  assert.notEqual(tickKey(buildView(hass, config, NOW)), tickKey(before));
});

test("les entités de la pièce sont relues quand le registre change", () => {
  const hass = makeHass();
  const room = resolveRoom(hass, DEVICE);
  assert.equal(resolveRoom(hass, DEVICE), room);
  const { [ENTITIES.forced_night]: _, ...entities } = hass.entities;
  hass.entities = entities;
  const fresh = resolveRoom(hass, DEVICE);
  assert.notEqual(fresh, room);
  assert.equal(fresh.forced_night, undefined);
  assert.equal(room.forced_night, ENTITIES.forced_night);
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
  assert.deepEqual(view.panes, []);
});

test("un groupe en pause disparaît des panneaux et revient à sa réactivation", () => {
  const paused = makeHass({ states: { [ENTITIES.auto_fans]: { state: "off", attributes: {} } } });
  const view = buildView(paused, config, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["lights"]);
  assert.ok(view.notes.includes("Automatisme du ventilateur en pause"));
  const resumed = makeHass({ states: { [ENTITIES.auto_fans]: { state: "on", attributes: {} } } });
  assert.deepEqual(buildView(resumed, config, NOW).panes.map((p) => p.kind), ["lights", "fans"]);
});

test("toutes les notes sont transmises, la carte n'en montre que deux d'emblée", () => {
  const hass = makeHass({
    room: { daylight_locked: true },
    states: {
      [ENTITIES.forced_night]: { state: "on", attributes: { until: inSeconds(3600) } },
      [ENTITIES.auto_fans]: { state: "off", attributes: {} },
    },
  });
  const notes = buildView(hass, config, NOW).notes;
  assert.equal(notes.length, 3);
  assert.match(notes[0], /^Nuit forcée/);
  assert.equal(notes[2], "Lumière du jour suffisante, pas d'allumage");
});

test("sans capteur de luminosité, la lumière suit le soleil", () => {
  const off = { "light.chambre": { state: "off", attributes: {} } };
  const hint = (sun, room = {}) =>
    buildView(makeHass({ room: { illuminance_sensor: null, ...room }, states: { ...off, "sun.sun": { state: sun, attributes: {} } } }), config, NOW).panes[0].hint;
  assert.equal(hint("above_horizon"), "S'allume après le coucher du soleil");
  assert.equal(hint("below_horizon"), "S'allume à ton arrivée");
  assert.equal(hint("above_horizon", { daylight_locked: true }), "Soleil levé");
  const locked = makeHass({ room: { illuminance_sensor: null, daylight_locked: true } });
  assert.ok(buildView(locked, config, NOW).notes.includes("Soleil levé, pas d'allumage"));
});

test("teinte de la lumière et capteurs de l'ambiance", () => {
  const hass = makeHass({
    states: {
      "light.chambre": {
        state: "on",
        attributes: { brightness: 179, supported_color_modes: ["color_temp"], color_mode: "color_temp", color_temp_kelvin: 2680 },
      },
    },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.panes[0].detail, "2\u202f700 K");
  assert.equal(view.panes[1].detail, undefined);
  assert.deepEqual(view.ambient.map((i) => i.entity), [
    ENTITIES.apparent_temperature, "sensor.humidite_chambre", "sensor.lux_chambre",
  ]);
});

test("hide_panes masque des panneaux sans toucher à la phrase", () => {
  const hass = makeHass({ climate: true, room: { fans_override_until: inSeconds(1800) } });
  const view = buildView(hass, { ...config, hide_panes: ["fans", "climate"] }, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["lights"]);
  assert.match(view.now.text, /^Ventilateur en manuel/);
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
  assert.equal(formatDuration(120, "s", t), "2 min");
  assert.equal(formatDuration(1800, "s", t), "30 min");
  assert.equal(formatDuration(45, "s", t), "45 s");
  assert.equal(formatDuration(150, "s", t), "2 min 30 s");
  assert.equal(formatDuration(90, "min", t), "1 h 30");
  assert.equal(formatDuration(50, "lx", t), null);
  assert.equal(formatDelay(7200, t), "2 h");
});

test("pas des durées : des valeurs rondes à l'horloge", () => {
  assert.equal(durationStep(120, 10, 0, 3600, "s"), 30); // 2 min → 2 min 30 s
  assert.equal(durationStep(900, 60, 0, 7200, "s"), 120); // 15 min → 16 min
  assert.equal(durationStep(1800, 60, 0, 14400, "s"), 300); // 30 min → 35 min
  assert.equal(durationStep(30, 5, 0, 600, "s"), 5);
  assert.equal(durationStep(30, 5, 0, 240, "min"), 5);
  assert.equal(durationStep(0, 7, 0, 100, "s"), 7); // aucun pas rond multiple de 7 au-delà : repli
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

  // Tous muets
  hass.states[ENTITIES.room_state].attributes.presence_sensors = ["binary_sensor.fp2_chambre", "binary_sensor.pir"];
  hass.states["binary_sensor.pir"] = { entity_id: "binary_sensor.pir", state: "unknown", attributes: {} };
  assert.equal(buildView(hass, config, NOW).notes[0], "Détecteurs indisponibles, la pièce reste occupée");
});

test("détecteur muet parmi d'autres : signalé avec son nom et la date", () => {
  const hass = makeHass({
    states: {
      "binary_sensor.pir": {
        state: "unavailable",
        attributes: { friendly_name: "PIR chambre" },
        last_changed: "2026-10-15T19:29:02Z",
      },
    },
  });
  hass.states[ENTITIES.room_state].attributes.presence_sensors = ["binary_sensor.fp2_chambre", "binary_sensor.pir"];
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Pièce occupée");
  assert.equal(view.notes[0], "PIR chambre indisponible depuis le 15/10");
});

test("pièce vide aux détecteurs muets : Lumina n'éteint plus rien, en tête des notes", () => {
  const hass = makeHass({
    room: { occupied: false, presence_unknown: true, daylight_locked: true },
    states: {
      "binary_sensor.fp2_chambre": { state: "unavailable", attributes: {}, last_changed: "2026-10-20T12:05:00Z" },
    },
  });
  hass.states[ENTITIES.room_state].state = "vacant";
  const notes = buildView(hass, config, NOW).notes;
  assert.match(notes[0], /^Détecteur indisponible depuis \d\d:\d\d : Lumina n'éteint plus rien$/);
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
  assert.deepEqual(fans.rows.at(-1).options, { all: "Allumer les autres", any: "Ne rien toucher" });
  assert.ok(tabs.find((tab) => tab.id === "night").rows.some((r) => r.key === "night_override_until_morning"));
});

test("pièce avec clim seule", () => {
  const hass = makeHass({ climate: true, room: { lights: [], fans: [] } });
  const view = buildView(hass, config, NOW);
  assert.deepEqual(view.panes.map((p) => p.kind), ["climate"]);
  assert.equal(view.now.text, "Pièce occupée");
});

// --- Lumina 0.10 : sommeil ----------------------------------------------------

const morningAt = () => {
  const morning = new Date(NOW);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(7, 0, 0, 0);
  return morning;
};

test("sommeil : phrase, bouton Réveiller et panneaux", () => {
  const hass = makeHass({
    sleep: true,
    room: { period: "night", sleeping: true, sleeping_until: morningAt().toISOString(), sleep_source: "manual" },
    states: { "light.chambre": { state: "off", attributes: { supported_color_modes: ["color_temp"] } } },
  });
  hass.states[ENTITIES.room_state].state = "sleeping";
  const view = buildView(hass, config, NOW);
  assert.equal(view.sleeping, true);
  assert.equal(view.now.text, "En sommeil jusqu'à 07:00");
  assert.equal(view.now.tone, "night");
  assert.equal(view.now.action.kind, "wake");
  assert.equal(view.panes[0].hint, "Pas d'allumage pendant le sommeil");

  hass.states[ENTITIES.sleep_brightness].state = "5";
  assert.equal(buildView(hass, config, NOW).panes[0].hint, "Veilleuse à 5 % pendant le sommeil");
});

test("sommeil : pièce vide présumée occupée, ventilateur et clim continuent", () => {
  const hass = makeHass({
    sleep: true,
    climate: true,
    room: {
      period: "night", occupied: false, sleeping: true, sleeping_until: morningAt().toISOString(),
      sleep_source: "manual", presumed_occupied: true,
    },
    states: { "sensor.temp_chambre": null },
  });
  hass.states[ENTITIES.room_state].attributes.temperature_sensor = null;
  hass.states[ENTITIES.room_state].state = "sleeping";
  const view = buildView(hass, config, NOW);
  assert.deepEqual(view.notes, ["Présence présumée malgré le détecteur"]);
  assert.equal(view.panes[1].hint, "Tourne jusqu'au réveil");
  assert.equal(view.panes[2].hint, "Lumina la laisse tourner pendant le sommeil");
});

test("sommeil : gestes jusqu'au réveil, lampe allumée à la main en note", () => {
  const hass = makeHass({
    sleep: true,
    room: {
      period: "night", sleeping: true, sleeping_until: morningAt().toISOString(), sleep_source: "lights_off",
      bedtime_gesture: "until_wake", fans_override_until: morningAt().toISOString(),
      lights_override_until: inSeconds(1800), overrides_until_wake: ["fans"],
    },
  });
  hass.states[ENTITIES.room_state].state = "sleeping";
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "En sommeil jusqu'à 07:00");
  assert.match(view.notes[0], /^Lumière en manuel jusqu'à \d\d:\d\d$/);
  assert.equal(view.panes[1].hint, "Manuel jusqu'au réveil");
});

test("sommeil deviné au salon : réveil quand la pièce se vide", () => {
  const hass = makeHass({
    sleep: true,
    room: {
      period: "night", sleeping: true, sleeping_until: morningAt().toISOString(),
      sleep_source: "lights_off", bedtime_gesture: "until_vacant",
    },
  });
  assert.deepEqual(buildView(hass, config, NOW).notes, ["Se réveille quand la pièce se vide"]);
});

test("Lumina 0.10.1 : lumière gardée éteinte jusqu'au départ", () => {
  const hass = makeHass({
    sleep: true,
    room: { lights_held: true },
    states: { "light.chambre": { state: "off", attributes: { supported_color_modes: ["color_temp"] } } },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.now.text, "Pièce occupée");
  assert.deepEqual(view.notes, ["Lumière gardée éteinte jusqu'à ton départ"]);
  assert.equal(view.panes[0].hint, "Reste éteinte jusqu'à ton départ");
});

test("réveil du matin : lumière gardée éteinte jusqu'à une heure précise", () => {
  const hass = makeHass({
    sleep: true,
    room: { lights_held: true, wake_hold_until: inSeconds(1800) },
    states: { "light.chambre": { state: "off", attributes: { supported_color_modes: ["color_temp"] } } },
  });
  const view = buildView(hass, config, NOW);
  assert.match(view.notes[0], /^Réveil : lumière gardée éteinte jusqu'à \d\d:\d\d$/);
  assert.match(view.panes[0].hint, /^Reste éteinte jusqu'à \d\d:\d\d$/);
});

test("Lumina 0.10 : réglages du sommeil dans l'onglet Nuit", () => {
  const view = buildView(makeHass({ sleep: true }), config, NOW);
  const night = settingTabs(view.entities, translator("fr")).find((tab) => tab.id === "night");
  assert.deepEqual(night.rows.map((r) => r.key), [
    "forced_night", "sleeping", "night_start", "night_end", "bedtime_gesture", "sleep_brightness",
  ]);
  assert.deepEqual(night.rows[4].options, { override: "Durée réglée", until_vacant: "Jusqu'au départ", until_wake: "Jusqu'au réveil" });
  assert.equal(night.rows[4].help, undefined);
  assert.equal(night.rows[4].optionHelp.until_vacant, "Sommeil jusqu'à ce que la pièce se vide");
});

test("Lumina 0.11 : fins de nuit des jours de repos et de vacances", () => {
  const nightRows = (states) => {
    const view = buildView(makeHass({ sleep: true, states }), config, NOW);
    return settingTabs(view.entities, translator("fr")).find((tab) => tab.id === "night").rows;
  };
  const rows = nightRows({
    [ENTITIES.night_end_day_off]: { state: "07:30:00", attributes: {} },
    [ENTITIES.night_end_holidays]: { state: "08:00:00", attributes: {} },
  });
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.help]).slice(3, 6), [
    ["night_end", "Fin de la nuit, en semaine", undefined],
    ["night_end_day_off", "Fin de la nuit, jours de repos", "Week-end et jours fériés"],
    ["night_end_holidays", "Fin de la nuit, en vacances", "Jours du calendrier de vacances"],
  ]);
  assert.equal(rows[4].kind, "time");

  // Sans Workday ni calendrier : une seule fin de nuit, pour tous les jours
  const plain = nightRows({});
  assert.equal(plain.find((r) => r.key === "night_end").label, "Fin de la nuit");
  assert.ok(!plain.some((r) => r.key === "night_end_day_off" || r.key === "night_end_holidays"));
});

test("Lumina 0.13 : soirée, pastille et réglages", () => {
  const hass = makeHass({
    sleep: true,
    room: { period: "evening" },
    states: {
      [ENTITIES.evening_start]: { state: "19:00:00", attributes: {} },
      [ENTITIES.evening_brightness]: { state: "70", attributes: { unit_of_measurement: "%", min: 1, max: 100, step: 1 } },
      [ENTITIES.evening_color_temp]: { state: "3000", attributes: { unit_of_measurement: "K", min: 0, max: 6500, step: 100 } },
    },
  });
  const view = buildView(hass, config, NOW);
  assert.equal(view.evening, true);
  assert.equal(view.night, false);

  const tabs = settingTabs(view.entities, translator("fr"));
  const lights = tabs.find((tab) => tab.id === "lights").rows.map((r) => r.key);
  assert.deepEqual(lights.slice(lights.indexOf("day_brightness"), lights.indexOf("day_brightness") + 2), [
    "day_brightness", "evening_brightness",
  ]);
  assert.ok(lights.includes("evening_color_temp"));
  const night = tabs.find((tab) => tab.id === "night").rows;
  const evening = night.find((r) => r.key === "evening_start");
  assert.equal(evening.label, "Début de la soirée");
  assert.equal(evening.kind, "time");
  assert.equal(night[night.indexOf(evening) + 1].key, "night_start");
});

test("avant Lumina 0.13 : pas de réglages de soirée", () => {
  const view = buildView(makeHass({ sleep: true }), config, NOW);
  assert.equal(view.evening, false);
  const keys = settingTabs(view.entities, translator("fr")).flatMap((tab) => tab.rows.map((r) => r.key));
  assert.ok(!keys.some((key) => key.startsWith("evening_")));
});
