// Tests de l'élément <lumina-card> : gestes, envois différés, focus, comptes
// à rebours. happy-dom fournit le DOM ; les minuteries et l'horloge sont
// simulées par node:test pour avancer le temps à la main.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { Window } from "happy-dom";

import { DEVICE, ENTITIES, makeHass } from "./fixtures.mjs";

const window = new Window({ url: "http://localhost/" });
for (const key of ["document", "customElements", "HTMLElement", "CustomEvent", "KeyboardEvent", "MouseEvent", "CSS"]) {
  globalThis[key] = window[key];
}
// La carte n'utilise de `window` que ses minuteries : elles passent par celles
// de Node, que mock.timers remplace
globalThis.window = Object.fromEntries(
  ["setTimeout", "clearTimeout", "setInterval", "clearInterval"].map((key) => [
    key,
    (...args) => globalThis[key](...args),
  ]),
);

// La carte doit voir le HTMLElement de happy-dom au chargement
const { LuminaCard } = await import("../build/card.js");
const { LuminaCardEditor } = await import("../build/editor.js");
customElements.define("lumina-card", LuminaCard);
customElements.define("lumina-card-editor", LuminaCardEditor);

const NOW = new Date("2026-10-20T15:00:00Z").getTime();
const inSeconds = (s) => new Date(NOW + s * 1000).toISOString();

/** Laisse s'exécuter les promesses en attente (appels de service). */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let card;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: NOW });
});

afterEach(() => {
  card?.remove();
  card = undefined;
  mock.timers.reset();
});

/** Monte une carte ; renvoie la carte, les appels de service et les notifications. */
function mount(options = {}, config = {}) {
  const calls = [];
  const notifications = [];
  const hass = makeHass({ ...options, calls });
  card = document.createElement("lumina-card");
  card.addEventListener("hass-notification", (event) => notifications.push(event.detail));
  card.setConfig({ type: "custom:lumina-card", device: DEVICE, ...config });
  card.hass = hass;
  document.body.appendChild(card);
  return { card, hass, calls, notifications, root: card.shadowRoot };
}

const $ = (root, selector) => root.querySelector(selector);

function openSettings(root, tab) {
  $(root, '[data-action="settings"]').click();
  if (tab) $(root, `[data-tab="${tab}"]`).click();
}

test("consigne de la clim : affichée tout de suite, envoyée une seule fois après une pause", async () => {
  const { root, calls } = mount({ climate: true });
  for (let i = 0; i < 3; i++) $(root, '[data-action="setpoint"][data-dir="1"]').click();
  assert.match($(root, ".pane-climate .stepper-value").textContent, /25,5/);
  mock.timers.tick(600);
  assert.equal(calls.length, 0);
  mock.timers.tick(100);
  await flush();
  assert.deepEqual(calls, [
    { domain: "climate", service: "set_temperature", data: { entity_id: ["climate.chambre"], temperature: 25.5 } },
  ]);
});

test("réglage numérique : pas ronds, envoi groupé après une pause", async () => {
  const { root, calls } = mount();
  openSettings(root, "lights");
  const plus = `[data-action="step"][data-dir="1"][data-entity="${ENTITIES.light_off_delay}"]`;
  $(root, plus).click();
  $(root, plus).click();
  const value = $(root, `.stepper-value[data-entity="${ENTITIES.light_off_delay}"]`);
  assert.equal(value.textContent.trim(), "3 min");
  assert.equal(value.getAttribute("title"), "180 s");
  mock.timers.tick(700);
  await flush();
  assert.deepEqual(calls, [
    { domain: "number", service: "set_value", data: { entity_id: ENTITIES.light_off_delay, value: 180 } },
  ]);
});

test("pastille Auto : pause, puis message avec Annuler qui réactive l'automatisme", async () => {
  const { root, calls, notifications } = mount();
  $(root, '.pill[data-kind="lights"]').click();
  await flush();
  assert.deepEqual(
    calls.map((c) => `${c.domain}.${c.service}`),
    ["switch.turn_off"],
  );
  const [toast] = notifications;
  assert.equal(toast.message, "Automatisme des lumières en pause");
  assert.equal(toast.action.text, "Annuler");
  toast.action.action();
  await flush();
  assert.deepEqual(calls.at(-1), { domain: "switch", service: "turn_on", data: { entity_id: ENTITIES.auto_lights } });
});

test("appel en échec : message d'erreur, pas de proposition d'annuler", async () => {
  const { root, hass, notifications } = mount();
  hass.callService = async () => {
    throw new Error("hors ligne");
  };
  $(root, '.pill[data-kind="lights"]').click();
  await flush();
  assert.deepEqual(notifications, [{ message: "Action impossible : hors ligne" }]);
});

test("compte à rebours : le texte avance sans recréer les panneaux", () => {
  const { root, hass } = mount({ room: { occupied: false, lights_off_at: inSeconds(95) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  card.hass = { ...hass, states: { ...hass.states } };
  const pane = $(root, ".pane-lights");
  assert.equal($(root, ".now-text").textContent, "La lumière s'éteint dans 1:35");
  assert.equal($(root, ".now").getAttribute("aria-live"), "off");
  mock.timers.tick(2000);
  assert.equal($(root, ".now-text").textContent, "La lumière s'éteint dans 1:33");
  // assert.ok plutôt qu'assert.equal : en cas d'échec, Node chercherait à
  // afficher deux éléments du DOM, un graphe sans fin
  assert.ok($(root, ".pane-lights") === pane, "panneau recréé au tic");
});

test("le focus reste sur la pastille après une mise à jour d'état", () => {
  const { root, hass } = mount();
  $(root, '.pill[data-kind="fans"]').focus();
  const light = hass.states["light.chambre"];
  card.hass = {
    ...hass,
    states: { ...hass.states, "light.chambre": { ...light, attributes: { ...light.attributes, brightness: 100 } } },
  };
  assert.equal(root.activeElement?.getAttribute("data-kind"), "fans");
  assert.ok(root.activeElement.classList.contains("pill"));
});

test("réglages : le focus passe au bouton Retour, puis revient à la roue dentée", () => {
  const { root } = mount();
  $(root, '[data-action="settings"]').focus();
  $(root, '[data-action="settings"]').click();
  assert.equal(root.activeElement?.dataset.action, "close");
  $(root, '[data-action="close"]').click();
  assert.equal(root.activeElement?.dataset.action, "settings");
});

test("onglets : les flèches changent d'onglet et déplacent le focus", () => {
  const { root } = mount();
  openSettings(root);
  const key = (k) =>
    root.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }));
  $(root, '[role="tab"][aria-selected="true"]').focus();
  key("ArrowRight");
  assert.equal(root.activeElement?.dataset.tab, "fans");
  assert.equal(root.activeElement.getAttribute("aria-selected"), "true");
  key("ArrowLeft");
  key("ArrowLeft");
  assert.equal(root.activeElement?.dataset.tab, "presence");
  assert.deepEqual(
    [...root.querySelectorAll('[role="tab"]')].map((t) => t.tabIndex),
    [-1, -1, -1, 0],
  );
});

test("curseur au clavier : valeur affichée tout de suite, envoyée une fois après une pause", async () => {
  const { root, calls } = mount();
  const press = () =>
    root.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
    );
  $(root, '.slider[data-kind="lights"]').focus();
  press();
  await flush();
  assert.equal($(root, '.slider[data-kind="lights"]').getAttribute("aria-valuetext"), "75 %");
  assert.equal(root.activeElement?.getAttribute("role"), "slider");
  assert.deepEqual(calls, []);
  press();
  press();
  mock.timers.tick(699);
  await flush();
  assert.deepEqual(calls, []);
  mock.timers.tick(1);
  await flush();
  assert.equal($(root, '.slider[data-kind="lights"]').getAttribute("aria-valuetext"), "85 %");
  assert.deepEqual(calls, [
    { domain: "light", service: "turn_on", data: { entity_id: ["light.chambre"], brightness_pct: 85 } },
  ]);
});

test("sans capteur de luminosité, l'aide des lumières suit le coucher du soleil", () => {
  const off = { "light.chambre": { state: "off", attributes: {} } };
  const sun = (state) => ({ "sun.sun": { state, attributes: {} } });
  const { card, hass, root } = mount({
    room: { illuminance_sensor: null },
    states: { ...off, ...sun("above_horizon") },
  });
  const hint = () => $(root, ".pane-lights .hint").textContent;
  assert.equal(hint(), "S'allume après le coucher du soleil");
  card.hass = { ...hass, states: { ...hass.states, ...sun("below_horizon") } };
  assert.equal(hint(), "S'allume à ton arrivée");
});

test("notes : deux d'emblée, les autres derrière +1", () => {
  const { root } = mount({
    room: { daylight_locked: true },
    states: {
      [ENTITIES.forced_night]: { state: "on", attributes: { until: inSeconds(3600) } },
      [ENTITIES.auto_fans]: { state: "off", attributes: {} },
    },
  });
  assert.equal(root.querySelectorAll(".notes li.note").length, 2);
  $(root, '[data-action="notes"]').click();
  assert.equal(root.querySelectorAll(".notes li.note").length, 3);
  assert.equal($(root, '[data-action="notes"]').textContent.trim(), "Moins");
});

test("options : compact, hide_settings", () => {
  const { root } = mount({ climate: true }, { compact: true, hide_settings: true });
  assert.ok(!$(root, '[data-action="settings"]'), "roue dentée affichée");
  assert.ok(!$(root, ".slider"), "curseur affiché");
  assert.deepEqual(
    [...root.querySelectorAll(".chip .value")].map((v) => v.textContent),
    ["70 %", "66 %", "Froid"],
  );
  assert.equal(card.getCardSize(), 2);
});

test("compact : la consigne de la clim se règle depuis la pastille", async () => {
  const { root, calls } = mount({ climate: true }, { compact: true });
  const minus = '.chip.pane-climate [data-action="setpoint"][data-dir="-1"]';
  $(root, minus).focus();
  $(root, minus).click();
  $(root, minus).click();
  assert.match($(root, ".chip.pane-climate .stepper-value").textContent, /23,0/);
  assert.equal(root.activeElement?.dataset.dir, "-1");
  mock.timers.tick(700);
  await flush();
  assert.deepEqual(calls, [
    { domain: "climate", service: "set_temperature", data: { entity_id: ["climate.chambre"], temperature: 23 } },
  ]);
});

test("valeur en attente : gardée le temps de la réponse, puis l'état réel reprend la main", async () => {
  const { root } = mount();
  const valuetext = () => $(root, '.slider[data-kind="lights"]').getAttribute("aria-valuetext");
  $(root, '.slider[data-kind="lights"]').focus();
  root.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
  mock.timers.tick(700);
  await flush();
  assert.equal(valuetext(), "75 %");
  // Home Assistant n'a pas renvoyé de nouvel état : la lampe est toujours à 70 %
  mock.timers.tick(2499);
  assert.equal(valuetext(), "75 %");
  mock.timers.tick(1);
  assert.equal(valuetext(), "70 %");
});

test("réglage numérique : la valeur envoyée s'efface si Home Assistant ne la renvoie pas", async () => {
  const { root } = mount();
  openSettings(root, "lights");
  const value = () => $(root, `.stepper-value[data-entity="${ENTITIES.light_off_delay}"]`);
  // La durée est écrite avec des espaces insécables
  const text = () =>
    value()
      .textContent.trim()
      .replace(/\u00a0/g, " ");
  $(root, `[data-action="step"][data-dir="1"][data-entity="${ENTITIES.light_off_delay}"]`).click();
  assert.equal(text(), "2 min 30 s");
  assert.ok(value().classList.contains("pending"));
  mock.timers.tick(700);
  await flush();
  mock.timers.tick(1500);
  assert.equal(text(), "2 min");
  assert.ok(!value().classList.contains("pending"));
});

test("curseur glissé : pas de redessin pendant le geste, un seul envoi au lâcher", async () => {
  const { root, hass, calls } = mount();
  const slider = $(root, '.slider[data-kind="lights"]');
  slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20 });
  const pointer = (type, clientX) =>
    slider.dispatchEvent(new window.PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true }));
  pointer("pointerdown", 100);
  assert.equal(slider.getAttribute("aria-valuetext"), "50 %");
  // Un état qui change pendant le geste ne recrée pas le curseur
  const light = hass.states["light.chambre"];
  card.hass = { ...hass, states: { ...hass.states, "light.chambre": { ...light } } };
  assert.ok($(root, '.slider[data-kind="lights"]') === slider, "curseur recréé pendant le glisser");
  pointer("pointermove", 150);
  assert.equal($(root, ".pane-lights .value").textContent, "75 %");
  assert.deepEqual(calls, []);
  pointer("pointerup", 180);
  await flush();
  assert.equal($(root, '.slider[data-kind="lights"]').getAttribute("aria-valuetext"), "90 %");
  assert.deepEqual(calls, [
    { domain: "light", service: "turn_on", data: { entity_id: ["light.chambre"], brightness_pct: 90 } },
  ]);
});

test("gestes de la carte : chaque bouton appelle le bon service", async () => {
  const cases = [
    {
      name: "icône : éteint le groupe",
      selector: '[data-action="toggle"][data-kind="lights"]',
      call: { domain: "homeassistant", service: "turn_off", data: { entity_id: ["light.chambre"] } },
    },
    {
      name: "pastille Jour : force la nuit",
      selector: '[data-action="period"]',
      call: { domain: "switch", service: "turn_on", data: { entity_id: ENTITIES.forced_night } },
    },
    {
      name: "bouton Sommeil : endort la pièce",
      options: { sleep: true },
      selector: '[data-action="sleep"]',
      call: { domain: "switch", service: "turn_on", data: { entity_id: ENTITIES.sleeping } },
    },
    {
      name: "pastille Manuel : rend la main",
      options: { room: { lights_override_until: inSeconds(3600) } },
      selector: '.pill-manual[data-kind="lights"]',
      call: { domain: "button", service: "press", data: { entity_id: ENTITIES.resume } },
    },
    {
      name: "tout en pause : Réactiver rallume les automatismes",
      options: {
        states: {
          [ENTITIES.auto_lights]: { state: "off", attributes: {} },
          [ENTITIES.auto_fans]: { state: "off", attributes: {} },
        },
      },
      selector: '.now-action[data-action="enable"]',
      call: {
        domain: "switch",
        service: "turn_on",
        data: { entity_id: [ENTITIES.auto_lights, ENTITIES.auto_fans] },
      },
    },
  ];
  for (const { name, options, selector, call } of cases) {
    const { root, calls } = mount(options);
    const button = $(root, selector);
    assert.ok(button, `${name} : bouton absent`);
    button.click();
    await flush();
    assert.deepEqual(calls, [call], name);
    card.remove();
  }
});

test("gestes des réglages : interrupteur, liste de choix et heure", async () => {
  const { root, calls } = mount();
  openSettings(root, "lights");
  $(root, `[data-action="switch"][data-entity="${ENTITIES.auto_lights}"]`).click();
  $(root, `[data-action="select"][data-entity="${ENTITIES.lights_mode}"][data-option="any"]`).click();
  $(root, '[data-tab="night"]').click();
  const time = $(root, `input[data-entity="${ENTITIES.night_start}"]`);
  time.value = "23:30";
  time.dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  assert.deepEqual(calls, [
    { domain: "switch", service: "toggle", data: { entity_id: ENTITIES.auto_lights } },
    { domain: "select", service: "select_option", data: { entity_id: ENTITIES.lights_mode, option: "any" } },
    { domain: "time", service: "set_value", data: { entity_id: ENTITIES.night_start, time: "23:30:00" } },
  ]);
});

test("carte retirée de la page : le compte à rebours s'arrête", () => {
  const { root, hass } = mount({ room: { occupied: false, lights_off_at: inSeconds(95) } });
  hass.states[ENTITIES.room_state].state = "vacant";
  card.hass = { ...hass, states: { ...hass.states } };
  assert.equal($(root, ".now-text").textContent, "La lumière s'éteint dans 1:35");
  card.remove();
  mock.timers.tick(2000);
  assert.equal($(root, ".now-text").textContent, "La lumière s'éteint dans 1:35");
});

test("réglage inconnu après un redémarrage de Lumina : un tiret, pas « NaN »", () => {
  const { root } = mount({
    states: {
      [ENTITIES.light_off_delay]: { state: "unknown", attributes: { unit_of_measurement: "s", min: 0, max: 3600 } },
    },
  });
  openSettings(root, "lights");
  assert.ok(!$(root, `[data-entity="${ENTITIES.light_off_delay}"]`), "réglage inconnu affiché");
  assert.ok(!root.querySelector(".rows").textContent.includes("NaN"));
});

test("zone renommée : le nom de la carte suit, sans changement d'état", () => {
  const { root, hass } = mount();
  assert.equal($(root, ".name").textContent, "Chambre Parents");
  card.hass = { ...hass, areas: { chambre: { area_id: "chambre", name: "Suite parentale" } } };
  assert.equal($(root, ".name").textContent, "Suite parentale");
});

test("carte retirée juste après un réglage : la valeur part quand même", async () => {
  const { root, calls } = mount();
  openSettings(root, "lights");
  $(root, `[data-action="step"][data-dir="1"][data-entity="${ENTITIES.light_off_delay}"]`).click();
  card.remove();
  mock.timers.tick(700);
  await flush();
  assert.deepEqual(calls, [
    { domain: "number", service: "set_value", data: { entity_id: ENTITIES.light_off_delay, value: 150 } },
  ]);
  // La valeur en attente s'efface ensuite sans erreur, carte retirée
  mock.timers.tick(1500);
});

test("changement d'état hors de la pièce : rien n'est recalculé ni redessiné", () => {
  const { root, hass } = mount();
  const pane = $(root, ".pane-lights");
  card.hass = {
    ...hass,
    states: { ...hass.states, "light.cuisine": { entity_id: "light.cuisine", state: "on", attributes: {} } },
  };
  assert.ok($(root, ".pane-lights") === pane, "carte redessinée");
  // La vue n'est pas recalculée : la même instance est gardée
  const view = card._view;
  card.hass = { ...hass, states: { ...hass.states } };
  assert.ok(card._view === view, "vue recalculée");
});

test("éditeur sans ha-form : la liste des pièces n'est pas réécrite à chaque mise à jour", () => {
  const editor = document.createElement("lumina-card-editor");
  document.body.appendChild(editor);
  const hass = makeHass();
  editor.setConfig({ type: "custom:lumina-card", device: DEVICE });
  editor.hass = hass;
  const select = editor.querySelector("select");
  assert.equal(select.value, DEVICE);
  editor.hass = { ...hass, states: { ...hass.states } };
  assert.ok(editor.querySelector("select") === select, "liste réécrite");
  editor.remove();
});
