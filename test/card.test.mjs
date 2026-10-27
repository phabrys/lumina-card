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
customElements.define("lumina-card", LuminaCard);

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

test("curseur au clavier : valeur affichée et envoyée tout de suite", async () => {
  const { root, calls } = mount();
  const slider = $(root, '.slider[data-kind="lights"]');
  slider.focus();
  slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
  await flush();
  assert.equal($(root, '.slider[data-kind="lights"]').getAttribute("aria-valuetext"), "75 %");
  assert.equal(root.activeElement?.getAttribute("role"), "slider");
  assert.deepEqual(calls, [
    { domain: "light", service: "turn_on", data: { entity_id: ["light.chambre"], brightness_pct: 75 } },
  ]);
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
