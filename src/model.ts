// Logique de la carte, sans DOM : retrouve les entités d'une pièce Lumina et
// calcule ce qui doit être affiché à un instant donné. Tout ce qui est décidé
// ici est couvert par les tests (test/model.test.mjs).

import type { IconName } from "./icons.js";
import { translator, type StringKey, type Translate } from "./i18n.js";

// --- Types minimaux de Home Assistant ----------------------------------------

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  translation_key?: string | null;
}

export interface Hass {
  states: Record<string, HassEntity>;
  entities?: Record<string, EntityRegistryEntry>;
  devices?: Record<string, { id: string; name?: string | null; name_by_user?: string | null; area_id?: string | null }>;
  areas?: Record<string, { area_id: string; name: string }>;
  language?: string;
  locale?: { language?: string };
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
}

export interface CardConfig {
  type: string;
  /** Appareil Lumina de la pièce (choisi dans l'éditeur). */
  device?: string;
  /** Alternative en YAML : n'importe quelle entité Lumina de la pièce. */
  entity?: string;
  name?: string;
  hide_ambient?: boolean;
}

// --- Entités d'une pièce -----------------------------------------------------

/** Clés de traduction des entités Lumina, telles que définies par l'intégration. */
export type LuminaKey =
  | "room_state" | "apparent_temperature" | "auto_lights" | "auto_fans" | "auto_climate" | "forced_night"
  | "resume" | "lights_mode" | "fans_mode" | "night_start" | "night_end" | "night_override_until_morning"
  | "lux_threshold" | "day_brightness" | "night_brightness" | "day_color_temp" | "night_color_temp"
  | "light_off_delay" | "night_light_off_delay" | "light_warning_duration" | "daylight_off_lux"
  | "temperature_threshold" | "night_temperature_threshold" | "fan_min_speed" | "fan_speed_range"
  | "fan_off_delay" | "night_fan_off_delay" | "vacancy_confirmation" | "override_duration"
  | "climate_vacant_day" | "climate_vacant_night" | "climate_vacant_delay" | "fans_with_climate" | "fan_mix_speed"
  | "sleeping" | "bedtime_gesture" | "sleep_brightness" | "night_end_day_off" | "night_end_holidays";

export type RoomEntities = Partial<Record<LuminaKey, string>>;

/** Appareils Lumina présents (une pièce = un appareil). */
export function luminaDevices(hass: Hass): string[] {
  const ids = new Set<string>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (entry.platform === "lumina" && entry.device_id) ids.add(entry.device_id);
  }
  return [...ids];
}

/** Appareil de la pièce, depuis `device` ou à défaut depuis `entity`. */
export function deviceOf(hass: Hass, config: CardConfig): string | undefined {
  if (config.device) return config.device;
  if (config.entity) return hass.entities?.[config.entity]?.device_id ?? undefined;
  return undefined;
}

/** Entités Lumina d'un appareil, indexées par clé de traduction. */
export function resolveRoom(hass: Hass, deviceId: string | undefined): RoomEntities {
  const room: RoomEntities = {};
  if (!deviceId) return room;
  for (const entry of Object.values(hass.entities ?? {})) {
    if (entry.platform === "lumina" && entry.device_id === deviceId && entry.translation_key) {
      room[entry.translation_key as LuminaKey] = entry.entity_id;
    }
  }
  return room;
}

export function roomName(hass: Hass, config: CardConfig, room: RoomEntities): string {
  if (config.name) return config.name;
  const deviceId = deviceOf(hass, config);
  const device = deviceId ? hass.devices?.[deviceId] : undefined;
  const areaId =
    device?.area_id ?? (room.room_state ? hass.entities?.[room.room_state]?.area_id : undefined);
  if (areaId && hass.areas?.[areaId]) return hass.areas[areaId].name;
  return device?.name_by_user || device?.name || "Lumina";
}

// --- Modèle d'affichage ------------------------------------------------------

export type Tone = "calm" | "occupied" | "manual" | "night" | "countdown" | "alert";

export interface NowLine {
  text: string;
  icon: IconName;
  tone: Tone;
  action?: { kind: "resume" | "enable" | "wake"; label: string };
}

export type AutoState = "auto" | "manual" | "paused";

export type PaneKind = "lights" | "fans" | "climate";

export interface Setpoint {
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface Pane {
  kind: PaneKind;
  title: string;
  entities: string[];
  on: boolean;
  /** Niveau 0–100 (luminosité moyenne ou vitesse), null si non réglable. */
  level: number | null;
  /** Pas du curseur : 1 pour la lumière, palier de vitesse du ventilateur. */
  step: number;
  value: string;
  hint: string;
  auto: AutoState;
  autoEntity?: string;
  /** Durée d'un tour d'hélice (s) quand le ventilateur tourne. */
  spin?: number;
  /** Clim : mode en cours (teinte du panneau) et consigne réglable. */
  mode?: string;
  setpoint?: Setpoint;
}

export interface AmbientItem {
  icon: IconName;
  value: string;
  detail?: string;
  title?: string;
}

export interface RoomView {
  status: "ok" | "missing" | "unavailable";
  name: string;
  night: boolean;
  forcedNight: boolean;
  /** Pièce en sommeil (Lumina 0.10). */
  sleeping: boolean;
  now: NowLine;
  notes: string[];
  panes: Pane[];
  ambient: AmbientItem[];
  /** Vrai si un compte à rebours est affiché (rafraîchissement chaque seconde). */
  ticking: boolean;
  entities: RoomEntities;
}

export interface Pending {
  lights?: number;
  fans?: number;
  /** Consigne de la clim en cours de réglage. */
  climate?: number;
}

/** États d'une clim qui ne la comptent pas comme allumée. */
const CLIMATE_OFF = new Set(["off", "unavailable", "unknown"]);

const HOLD_INACTIVE = new Set(["off", "idle", "standby", "paused", "unavailable", "unknown", "not_home", "closed"]);

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function num(hass: Hass, entityId: string | undefined | null): number | null {
  if (!entityId) return null;
  const state = hass.states[entityId];
  if (!state || state.state === "unavailable" || state.state === "unknown") return null;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : null;
}

function isOn(hass: Hass, entityId: string | undefined): boolean {
  return !!entityId && hass.states[entityId]?.state === "on";
}

function friendly(hass: Hass, entityId: string): string {
  return hass.states[entityId]?.attributes.friendly_name ?? entityId;
}

/** « 45 s », « 1:24 », « 1 h 05 » */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatClock(date: Date, language: string): string {
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value: number, language: string, digits = 0): string {
  return value.toLocaleString(language, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function languageOf(hass: Hass): string {
  return hass.locale?.language ?? hass.language ?? "fr";
}

/**
 * Calcule l'affichage d'une pièce. `now` est passé explicitement pour que les
 * comptes à rebours soient testables.
 */
export function buildView(
  hass: Hass,
  config: CardConfig,
  now: Date,
  pending: Pending = {},
): RoomView {
  const language = languageOf(hass);
  const t = translator(language);
  const room = resolveRoom(hass, deviceOf(hass, config));
  const name = roomName(hass, config, room);
  const empty: Omit<RoomView, "status" | "now"> = {
    name, night: false, forcedNight: false, sleeping: false, notes: [], panes: [], ambient: [], ticking: false, entities: room,
  };

  if (!room.room_state) {
    return { ...empty, status: "missing", now: { text: t("missing"), icon: "alert", tone: "alert" } };
  }
  const roomState = hass.states[room.room_state];
  if (!roomState || roomState.state === "unavailable" || roomState.state === "unknown") {
    return { ...empty, status: "unavailable", now: { text: t("unavailable"), icon: "alert", tone: "alert" } };
  }

  const a = roomState.attributes;
  const night = a.period === "night";
  // En sommeil, Lumina applique les réglages de nuit, sieste comprise.
  const sleeping = a.sleeping === true;
  const nightRules = night || sleeping;
  // « En sommeil » et « Contrôle manuel » ne disent pas si la pièce est occupée.
  const occupied = typeof a.occupied === "boolean" ? a.occupied : roomState.state !== "vacant";
  // Ventilateurs et clim ne s'arrêtent pas : un dormeur peut échapper au détecteur.
  const presumed = sleeping && a.presumed_occupied === true;
  const sleepingUntil = parseDate(a.sleeping_until);
  const lightsIds: string[] = a.lights ?? [];
  const fansIds: string[] = a.fans ?? [];
  const climateIds: string[] = a.climates ?? [];
  const lightsAuto = autoState(hass, room.auto_lights, a.lights_override_until);
  const fansAuto = autoState(hass, room.auto_fans, a.fans_override_until);
  const climateAuto = autoState(hass, room.auto_climate, a.climate_override_until);
  const clock = (d: Date) => formatClock(d, language);
  const countdown = (d: Date) => formatCountdown(d.getTime() - now.getTime());

  const lightsOffAt = parseDate(a.lights_off_at);
  const fansOffAt = parseDate(a.fans_off_at);
  const vacancyAt = parseDate(a.vacancy_at);
  const lightsManualUntil = parseDate(a.lights_override_until);
  const fansManualUntil = parseDate(a.fans_override_until);
  const climateManualUntil = parseDate(a.climate_override_until);
  const climateAt = parseDate(a.climate_vacant_at);
  const forcedUntil = room.forced_night ? parseDate(hass.states[room.forced_night]?.attributes.until) : null;
  const forcedNight = isOn(hass, room.forced_night);

  const notes: string[] = [];
  let ticking = false;
  let line: NowLine;

  const hasLights = lightsIds.length > 0;
  const hasFans = fansIds.length > 0;
  const hasClimate = climateIds.length > 0;
  const lightsPaused = hasLights && lightsAuto === "paused";
  const fansPaused = hasFans && fansAuto === "paused";
  const climatePaused = hasClimate && climateAuto === "paused";
  // Contrôles manuels « jusqu'au réveil » (Lumina 0.10), « jusqu'au matin »
  // publiés depuis 0.9.2, déduits de l'heure de fin de nuit avant.
  const wake = Array.isArray(a.overrides_until_wake);
  const morningKinds: unknown = wake ? a.overrides_until_wake : a.overrides_until_morning;
  const untilMorning = (kind: string, until: Date | null): boolean =>
    Array.isArray(morningKinds)
      ? morningKinds.includes(kind)
      : night && isOn(hass, room.night_override_until_morning) && !!until && isNightEnd(hass, room.night_end, until);
  const groups = [
    { kind: "lights", has: hasLights, auto: lightsAuto, until: lightsManualUntil, word: t("w_lights") },
    { kind: "fans", has: hasFans, auto: fansAuto, until: fansManualUntil, word: t("w_fans") },
    { kind: "climate", has: hasClimate, auto: climateAuto, until: climateManualUntil, word: t("w_climate") },
  ]
    .filter((g) => g.has)
    .map((g) => ({ ...g, morning: g.auto === "manual" && untilMorning(g.kind, g.until) }));
  const manual = groups.filter((g) => g.auto === "manual");
  const morningOf = (kind: string) => groups.some((g) => g.kind === kind && g.morning);
  const climateOn = climateIds.some((id) => isClimateOn(hass.states[id]));

  // Échéances en pièce vide : extinctions, puis action sur la clim
  const scheduled: { at: Date; text: (t: string) => string }[] = [];
  if (lightsOffAt) scheduled.push({ at: lightsOffAt, text: (d) => t("lights_off_in", { t: d }) });
  if (fansOffAt) scheduled.push({ at: fansOffAt, text: (d) => t("fans_off_in", { t: d }) });
  const climateAction: string | undefined = a.climate_vacant_action;
  if (climateAt && climateOn && climateAction && climateAction !== "none") {
    const heating = climateIds.some((id) => hass.states[id]?.state === "heat");
    const key: StringKey =
      climateAction === "off" ? "climate_off_in"
      : climateAction === "eco" ? "climate_eco_in"
      : heating ? "climate_setback_heat_in" : "climate_setback_in";
    scheduled.push({ at: climateAt, text: (d) => t(key, { t: d }) });
  }
  scheduled.sort((x, y) => x.at.getTime() - y.at.getTime());

  if (a.lights_warning && lightsOffAt) {
    line = { text: t("warning", { t: countdown(lightsOffAt) }), icon: "timer", tone: "countdown" };
    notes.push(t("note_warning"));
    ticking = true;
  } else if (sleeping) {
    line = {
      text: sleepingUntil ? t("sleeping", { h: clock(sleepingUntil) }) : t("sleeping_plain"),
      icon: "sleep",
      tone: "night",
      action: room.sleeping ? { kind: "wake", label: t("wake") } : undefined,
    };
    // Une lampe allumée à la main garde la durée réglée, puis s'éteint.
    const timed = manual.filter((g) => !g.morning && g.until);
    if (timed.length) {
      const until = timed.map((g) => g.until!).sort((x, y) => x.getTime() - y.getTime())[0];
      notes.push(t("manual", { what: joinWords(timed.map((g) => g.word), t("w_and")), h: clock(until) }));
    }
    if (!occupied && scheduled.length) {
      notes.push(scheduled[0].text(countdown(scheduled[0].at)));
      ticking = true;
    }
    if (presumed && !occupied && (hasFans || hasClimate)) notes.push(t("note_presumed"));
    else if (a.sleep_source === "lights_off" && a.bedtime_gesture === "until_vacant") notes.push(t("note_sleep_until_vacant"));
    else if (a.sleep_source === "entity" && a.sleep_entity) notes.push(t("note_sleep_entity", { name: friendly(hass, a.sleep_entity) }));
  } else if (manual.length) {
    // Les groupes à durée réglée d'abord, avec leur échéance la plus proche,
    // puis ceux qui tiennent jusqu'au matin.
    const timed = manual.filter((g) => !g.morning);
    const morning = manual.filter((g) => g.morning);
    const earliest = (list: typeof manual) => list
      .map((g) => g.until)
      .filter((d): d is Date => d !== null)
      .sort((x, y) => x.getTime() - y.getTime())[0];
    const until = earliest(timed.length ? timed : morning);
    const and = t("w_and");
    const h = until ? clock(until) : "…";
    line = {
      text: !timed.length
        ? t(wake ? "manual_wake" : "manual_morning", { what: joinWords(morning.map((g) => g.word), and), h })
        : morning.length
          ? t(wake ? "manual_mixed_wake" : "manual_mixed", {
              what: joinWords(timed.map((g) => g.word), and),
              h,
              rest: joinWords(morning.map((g) => g.word), and).toLowerCase(),
            })
          : t("manual", { what: joinWords(timed.map((g) => g.word), and), h }),
      icon: "hand",
      tone: "manual",
      action: room.resume ? { kind: "resume", label: t("resume") } : undefined,
    };
  } else if (a.vacancy_pending && vacancyAt) {
    line = { text: t("vacancy", { t: countdown(vacancyAt) }), icon: "timerOutline", tone: "countdown" };
    ticking = true;
  } else if (!occupied && scheduled.length) {
    const [first, ...rest] = scheduled;
    line = { text: first.text(countdown(first.at)), icon: "timerOutline", tone: "countdown" };
    for (const next of rest) notes.push(next.text(countdown(next.at)));
    ticking = true;
  } else if (groups.length && groups.every((g) => g.auto === "paused")) {
    line = { text: t("paused"), icon: "pause", tone: "calm", action: { kind: "enable", label: t("enable") } };
  } else if (occupied && a.presence_hold_active && !(a.presence_sensors ?? []).some((e: string) => isOn(hass, e))) {
    const holder = (a.presence_hold_entities ?? []).find((e: string) => {
      const state = hass.states[e];
      return state && !HOLD_INACTIVE.has(state.state);
    });
    line = { text: t("hold", { name: holder ? friendly(hass, holder) : "…" }), icon: "tv", tone: "occupied" };
  } else if (occupied) {
    line = night
      ? { text: t("occupied_night"), icon: "moon", tone: "night" }
      : { text: t("occupied"), icon: "account", tone: "occupied" };
  } else {
    line = night
      ? { text: t("vacant_night"), icon: "moon", tone: "night" }
      : { text: t("vacant"), icon: "home", tone: "calm" };
  }

  // Notes secondaires, par ordre d'importance
  const sensors: string[] = a.presence_sensors ?? [];
  const sensorStates = sensors.map((e) => hass.states[e]).filter((s): s is HassEntity => !!s);
  if (occupied && sensorStates.length && sensorStates.every((s) => s.state === "unavailable" || s.state === "unknown")) {
    notes.push(t(sensors.length > 1 ? "note_sensors_unavailable" : "note_sensor_unavailable"));
  }
  if (forcedNight) notes.push(t("note_forced_night", { h: forcedUntil ? clock(forcedUntil) : "…" }));
  if (line.action?.kind !== "enable") {
    if (lightsPaused) notes.push(t("note_lights_paused"));
    if (fansPaused) notes.push(t("note_fans_paused"));
    if (climatePaused) notes.push(t("note_climate_paused"));
  }
  const applied: string | null = hasClimate && !occupied ? a.climate_vacant_applied ?? null : null;
  if (applied === "off" || applied === "eco" || applied === "setback") {
    notes.push(t(applied === "off" ? "note_climate_off" : applied === "eco" ? "note_climate_eco" : "note_climate_setback"));
  }
  if (hasLights && a.daylight_locked) notes.push(t("note_daylight"));
  if (hasLights && a.lights_held && !lightsPaused) {
    // Répit du réveil : jusqu'à une heure précise depuis Lumina 0.10.2
    const held = parseDate(a.wake_hold_until);
    notes.push(held ? t("note_lights_held_until", { h: clock(held) }) : t("note_lights_held"));
  }
  if (hasLights && night && !sleeping && !lightsPaused && num(hass, room.night_brightness) === 0) {
    notes.push(t("note_no_night_light"));
  }

  const panes: Pane[] = [];
  const manualHint = (until: Date | null, kind: string) =>
    morningOf(kind)
      ? t(wake ? "hint_manual_wake" : "hint_manual_morning")
      : t("hint_manual", { h: until ? clock(until) : "…" });
  const mode: PaneMode = { night: nightRules, sleeping, presumed };
  // Un groupe que Lumina ne gère plus (automatisme en pause) n'a pas de panneau
  if (hasLights && !lightsPaused) panes.push(lightsPane(hass, room, a, t, lightsIds, lightsAuto, manualHint(lightsManualUntil, "lights"), mode, language, pending.lights));
  if (hasFans && !fansPaused) panes.push(fansPane(hass, room, a, t, fansIds, fansAuto, manualHint(fansManualUntil, "fans"), mode, language, pending.fans));
  if (hasClimate && !climatePaused) panes.push(climatePane(hass, room, a, t, climateIds, climateAuto, manualHint(climateManualUntil, "climate"), mode, pending.climate));

  return {
    status: "ok",
    name,
    night,
    forcedNight,
    sleeping,
    now: line,
    notes: notes.slice(0, 2),
    panes,
    ambient: config.hide_ambient ? [] : ambient(hass, room, a, t, language),
    ticking,
    entities: room,
  };
}

/** « lumière, ventilateur et clim », avec une majuscule initiale. */
function joinWords(words: string[], and: string): string {
  const text = words.length > 1 ? `${words.slice(0, -1).join(", ")} ${and} ${words[words.length - 1]}` : words[0] ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** L'échéance tombe-t-elle à l'heure de fin de nuit ? (contrôle manuel « jusqu'au matin ») */
function isNightEnd(hass: Hass, nightEnd: string | undefined, until: Date): boolean {
  const [h, m] = (nightEnd ? hass.states[nightEnd]?.state ?? "" : "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) && until.getHours() === h && until.getMinutes() === m;
}

function isClimateOn(state: HassEntity | undefined): boolean {
  return !!state && !CLIMATE_OFF.has(state.state);
}

function autoState(hass: Hass, autoEntity: string | undefined, overrideUntil: unknown): AutoState {
  if (autoEntity && hass.states[autoEntity]?.state === "off") return "paused";
  if (overrideUntil) return "manual";
  return "auto";
}

/** Période qui règle les panneaux : nuit (ou sommeil), sommeil, présomption d'occupation. */
interface PaneMode {
  night: boolean;
  sleeping: boolean;
  presumed: boolean;
}

function lightLevel(state: HassEntity | undefined): number | null {
  if (!state || state.state !== "on") return null;
  const brightness = state.attributes.brightness;
  return typeof brightness === "number" ? Math.round((brightness / 255) * 100) : null;
}

function lightDimmable(state: HassEntity | undefined): boolean {
  if (!state || !state.entity_id.startsWith("light.")) return false;
  const modes: string[] = state.attributes.supported_color_modes ?? [];
  return modes.some((m) => m !== "onoff");
}

function lightsPane(
  hass: Hass, room: RoomEntities, a: Record<string, any>, t: Translate, ids: string[],
  auto: AutoState, manualHint: string, { night, sleeping }: PaneMode, language: string,
  pending: number | undefined,
): Pane {
  const states = ids.map((id) => hass.states[id]);
  const onStates = states.filter((s) => s?.state === "on");
  const levels = onStates.map(lightLevel).filter((v): v is number => v !== null);
  const dimmable = states.some(lightDimmable);
  let level = dimmable ? (levels.length ? Math.round(levels.reduce((x, y) => x + y, 0) / levels.length) : 0) : null;
  let on = onStates.length > 0;
  if (pending !== undefined) {
    level = dimmable ? pending : level;
    on = pending > 0;
  }

  let value = on ? (level !== null ? `${level} %` : t("on")) : t("off");
  if (ids.length > 1 && on && pending === undefined) value += ` · ${t("of_total", { n: onStates.length, total: ids.length })}`;

  let hint: string;
  if (auto === "paused") hint = t("hint_paused");
  else if (auto === "manual") hint = manualHint;
  else if (on) {
    const delay = num(hass, night ? room.night_light_off_delay ?? room.light_off_delay : room.light_off_delay);
    hint = delay !== null ? t("hint_lights_off_after", { d: formatDelay(delay, t) }) : t("hint_auto_on");
  } else if (a.lights_held) {
    const held = parseDate(a.wake_hold_until);
    hint = held ? t("hint_lights_held_until", { h: formatClock(held, language) }) : t("hint_lights_held");
  }
  else if (sleeping) {
    const nightLight = num(hass, room.sleep_brightness);
    hint = nightLight ? t("hint_sleep_night_light", { v: formatNumber(nightLight, language) }) : t("hint_no_sleep_light");
  } else if (a.daylight_locked) hint = t("hint_daylight");
  else if (night && num(hass, room.night_brightness) === 0) hint = t("hint_no_night");
  else {
    const threshold = num(hass, room.lux_threshold);
    hint = a.illuminance_sensor && threshold !== null
      ? t("hint_lights_below", { v: formatNumber(threshold, language) })
      : t("hint_lights_auto");
  }

  return { kind: "lights", title: t("lights"), entities: ids, on, level, step: 1, value, hint, auto, autoEntity: room.auto_lights };
}

function fansPane(
  hass: Hass, room: RoomEntities, a: Record<string, any>, t: Translate, ids: string[],
  auto: AutoState, manualHint: string, { night, presumed }: PaneMode, language: string,
  pending: number | undefined,
): Pane {
  const states = ids.map((id) => hass.states[id]);
  const onStates = states.filter((s) => s?.state === "on");
  const speeds = onStates
    .map((s) => (typeof s?.attributes.percentage === "number" ? s.attributes.percentage : null))
    .filter((v): v is number => v !== null);
  const adjustable = states.some((s) => s?.entity_id.startsWith("fan.") && "percentage" in (s.attributes ?? {}));
  let level = adjustable ? (speeds.length ? Math.round(speeds.reduce((x, y) => x + y, 0) / speeds.length) : 0) : null;
  let on = onStates.length > 0;
  if (pending !== undefined) {
    level = adjustable ? pending : level;
    on = pending > 0;
  }

  const value = on ? (level !== null && level > 0 ? `${level} %` : t("fan_on")) : t("fan_off");

  let hint: string;
  const threshold = num(hass, night ? room.night_temperature_threshold ?? room.temperature_threshold : room.temperature_threshold);
  if (auto === "paused") hint = t("hint_paused_fans");
  else if (auto === "manual") hint = manualHint;
  else if (a.climate_running && a.fans_with_climate === "mix") {
    const speed = num(hass, room.fan_mix_speed);
    hint = speed !== null ? t("hint_fans_mix", { v: formatNumber(speed, language) }) : t("hint_fans_mix_plain");
  } else if (a.climate_running && a.fans_with_climate === "off") hint = t("hint_fans_climate_off");
  else if (on) {
    if (a.temperature_sensor && threshold !== null) {
      // Lumina arrête les ventilateurs 1 °C sous le seuil (hystérésis)
      hint = t(a.humidity_sensor ? "hint_fans_stop_below_apparent" : "hint_fans_stop_below", {
        v: formatNumber(threshold - 1, language, 1),
      });
    } else if (presumed) hint = t("hint_fans_until_wake");
    else {
      const delay = num(hass, night ? room.night_fan_off_delay ?? room.fan_off_delay : room.fan_off_delay);
      hint = delay !== null ? t("hint_fans_off_after", { d: formatDelay(delay, t) }) : t("hint_auto_on");
    }
  } else if (a.temperature_sensor) {
    hint = threshold === null
      ? t("hint_fans_presence")
      : t(a.humidity_sensor ? "hint_fans_at_apparent" : "hint_fans_at", { v: formatNumber(threshold, language, 1) });
  } else hint = t("hint_fans_presence");

  // Un tour toutes les 2,4 s à basse vitesse, 0,45 s à pleine vitesse
  const spin = on ? 2.4 - ((level ?? 60) / 100) * 1.95 : undefined;

  const step = Math.max(1, Number(states.find((s) => s?.attributes.percentage_step)?.attributes.percentage_step ?? 1));
  return { kind: "fans", title: t("fans"), entities: ids, on, level, step, value, hint, auto, autoEntity: room.auto_fans, spin };
}

function climatePane(
  hass: Hass, room: RoomEntities, a: Record<string, any>, t: Translate, ids: string[],
  auto: AutoState, manualHint: string, { night, presumed }: PaneMode, pending: number | undefined,
): Pane {
  const states = ids.map((id) => hass.states[id]).filter((s): s is HassEntity => !!s);
  const active = states.filter(isClimateOn);
  const main = active[0] ?? states[0];
  const on = active.length > 0;
  const mode = on ? main.state : "off";

  let value = t("off");
  if (on) {
    const hvac: Record<string, StringKey> = {
      cool: "hvac_cool", heat: "hvac_heat", heat_cool: "hvac_auto", auto: "hvac_auto", dry: "hvac_dry", fan_only: "hvac_fan_only",
    };
    value = main.attributes.preset_mode === "eco" ? t("preset_eco") : hvac[mode] ? t(hvac[mode]) : t("on");
    if (ids.length > 1) value += ` · ${t("of_total", { n: active.length, total: ids.length })}`;
  }

  // Consigne réglable seulement quand la clim tourne et en publie une
  let setpoint: Setpoint | undefined;
  const target = main?.attributes.temperature;
  if (on && typeof target === "number") {
    setpoint = {
      value: pending ?? target,
      min: Number(main.attributes.min_temp ?? 7),
      max: Number(main.attributes.max_temp ?? 35),
      step: Number(main.attributes.target_temp_step ?? 0.5),
    };
  }

  let hint: string;
  const action: string | undefined = a.climate_vacant_action;
  const delay = num(hass, room.climate_vacant_delay);
  if (auto === "paused") hint = t("hint_paused");
  else if (auto === "manual") hint = manualHint;
  else if (a.climate_vacant_applied) hint = t("hint_climate_restore");
  else if (!on) hint = t("hint_climate_never_on");
  // Lumina ne touche pas une clim en simple ventilation (depuis 0.9.0)
  else if (mode === "fan_only") hint = t("hint_climate_fan_only");
  // Pièce présumée occupée : aucune action en ton absence pendant le sommeil
  else if (presumed) hint = t("hint_climate_untouched_sleep");
  else if (!action || action === "none") hint = t(night ? "hint_climate_untouched_night" : "hint_climate_untouched");
  else if (delay === null) hint = t("hint_auto_on");
  else {
    const key: StringKey =
      action === "off" ? "hint_climate_off_after" : action === "eco" ? "hint_climate_eco_after" : "hint_climate_setback_after";
    hint = t(key, { d: formatDelay(delay, t) });
  }

  return {
    kind: "climate", title: t("climate"), entities: ids, on, level: null, step: 1, value, hint, auto,
    autoEntity: room.auto_climate, mode, setpoint,
  };
}

function ambient(hass: Hass, room: RoomEntities, a: Record<string, any>, t: Translate, language: string): AmbientItem[] {
  const items: AmbientItem[] = [];
  const measured = num(hass, a.temperature_sensor);
  const apparent = num(hass, room.apparent_temperature);
  if (apparent !== null) {
    items.push({
      icon: "thermometer",
      value: `${formatNumber(apparent, language, 1)} °C`,
      detail: t("apparent"),
      title: measured !== null ? t("measured", { v: formatNumber(measured, language, 1) }) : undefined,
    });
  } else if (measured !== null) {
    items.push({ icon: "thermometer", value: `${formatNumber(measured, language, 1)} °C` });
  }
  const humidity = num(hass, a.humidity_sensor);
  if (humidity !== null) items.push({ icon: "water", value: `${formatNumber(humidity, language)} %` });
  const lux = num(hass, a.illuminance_sensor);
  if (lux !== null) items.push({ icon: "brightness", value: `${formatNumber(lux, language)} lx` });
  return items;
}

// --- Réglages ------------------------------------------------------------------

export type SettingKind = "number" | "time" | "select" | "switch";

export interface SettingRow {
  key: LuminaKey;
  entity: string;
  kind: SettingKind;
  label: string;
  help?: string;
  /** Libellés des options d'une liste de choix. */
  options?: Record<string, string>;
  /** Aide propre à l'option choisie, à la place de `help`. */
  optionHelp?: Record<string, string>;
}

export interface SettingTab {
  id: "lights" | "fans" | "climate" | "night" | "presence";
  label: string;
  icon: IconName;
  rows: SettingRow[];
}

const ALL_ANY: Record<string, StringKey> = { all: "o_all", any: "o_any" };
const CLIMATE_ACTIONS: Record<string, StringKey> = {
  off: "o_climate_off", eco: "o_climate_eco", setback: "o_climate_setback", none: "o_climate_none",
};
const FANS_WITH_CLIMATE: Record<string, StringKey> = { normal: "o_fans_normal", mix: "o_fans_mix", off: "o_fans_off" };
const BEDTIME: Record<string, StringKey> = {
  override: "o_bedtime_override", until_vacant: "o_bedtime_until_vacant", until_wake: "o_bedtime_until_wake",
};
const BEDTIME_HELP: Record<string, StringKey> = {
  override: "h_bedtime_override", until_vacant: "h_bedtime_until_vacant", until_wake: "h_bedtime_until_wake",
};

type RowSpec = [LuminaKey, SettingKind, StringKey, StringKey?, Record<string, StringKey>?, Record<string, StringKey>?];

const TABS: { id: SettingTab["id"]; label: StringKey; icon: IconName; rows: RowSpec[] }[] = [
  {
    id: "lights", label: "tab_lights", icon: "lightbulb", rows: [
      ["auto_lights", "switch", "s_auto"],
      ["lux_threshold", "number", "s_lux_threshold"],
      ["day_brightness", "number", "s_day_brightness"],
      ["night_brightness", "number", "s_night_brightness", "h_night_brightness"],
      ["day_color_temp", "number", "s_day_color_temp", "h_color_temp"],
      ["night_color_temp", "number", "s_night_color_temp", "h_color_temp"],
      ["light_off_delay", "number", "s_light_off_delay"],
      ["night_light_off_delay", "number", "s_night_light_off_delay"],
      ["light_warning_duration", "number", "s_light_warning_duration", "h_light_warning_duration"],
      ["daylight_off_lux", "number", "s_daylight_off_lux", "h_daylight_off_lux"],
      ["lights_mode", "select", "s_lights_mode", undefined, ALL_ANY],
    ],
  },
  {
    id: "fans", label: "tab_fans", icon: "fan", rows: [
      ["auto_fans", "switch", "s_auto"],
      ["temperature_threshold", "number", "s_temperature_threshold"],
      ["night_temperature_threshold", "number", "s_night_temperature_threshold"],
      ["fan_min_speed", "number", "s_fan_min_speed", "h_fan_min_speed"],
      ["fan_speed_range", "number", "s_fan_speed_range", "h_fan_speed_range"],
      ["fan_off_delay", "number", "s_fan_off_delay"],
      ["night_fan_off_delay", "number", "s_night_fan_off_delay"],
      ["fans_mode", "select", "s_fans_mode", undefined, ALL_ANY],
    ],
  },
  {
    id: "climate", label: "tab_climate", icon: "climate", rows: [
      ["auto_climate", "switch", "s_auto"],
      ["climate_vacant_day", "select", "s_climate_vacant_day", "h_climate_vacant", CLIMATE_ACTIONS],
      ["climate_vacant_night", "select", "s_climate_vacant_night", "h_climate_vacant_night", CLIMATE_ACTIONS],
      ["climate_vacant_delay", "number", "s_climate_vacant_delay", "h_climate_vacant_delay"],
      ["fans_with_climate", "select", "s_fans_with_climate", undefined, FANS_WITH_CLIMATE],
      ["fan_mix_speed", "number", "s_fan_mix_speed"],
    ],
  },
  {
    id: "night", label: "tab_night", icon: "moon", rows: [
      ["forced_night", "switch", "s_forced_night", "h_forced_night"],
      ["sleeping", "switch", "s_sleeping", "h_sleeping"],
      ["night_start", "time", "s_night_start", "h_night_window"],
      ["night_end", "time", "s_night_end"],
      // Lumina 0.11, avec Workday ou un calendrier de vacances
      ["night_end_day_off", "time", "s_night_end_day_off", "h_night_end_day_off"],
      ["night_end_holidays", "time", "s_night_end_holidays", "h_night_end_holidays"],
      ["bedtime_gesture", "select", "s_bedtime_gesture", undefined, BEDTIME, BEDTIME_HELP],
      ["sleep_brightness", "number", "s_sleep_brightness", "h_sleep_brightness"],
      // Lumina avant 0.10
      ["night_override_until_morning", "switch", "s_night_override_until_morning", "h_night_override_until_morning"],
    ],
  },
  {
    id: "presence", label: "tab_presence", icon: "presence", rows: [
      ["vacancy_confirmation", "number", "s_vacancy_confirmation", "h_vacancy_confirmation"],
      ["override_duration", "number", "s_override_duration", "h_override_duration"],
    ],
  },
];

/** Onglets de réglages, limités aux entités qui existent pour la pièce. */
export function settingTabs(room: RoomEntities, t: Translate): SettingTab[] {
  return TABS.map((tab) => ({
    id: tab.id,
    label: t(tab.label),
    icon: tab.icon,
    rows: tab.rows
      .filter(([key]) => room[key])
      .map(([key, kind, label, help, options, optionHelp]) => ({
        key, entity: room[key]!, kind, label: t(rowLabel(room, key, label)), help: help ? t(help) : undefined,
        options: options && translateValues(options, t),
        optionHelp: optionHelp && translateValues(optionHelp, t),
      })),
  })).filter((tab) => tab.rows.length > 0);
}

/** Avec des fins de nuit de repos ou de vacances, la fin de nuit seule vaut pour la semaine. */
function rowLabel(room: RoomEntities, key: LuminaKey, label: StringKey): StringKey {
  return key === "night_end" && (room.night_end_day_off || room.night_end_holidays) ? "s_night_end_workday" : label;
}

function translateValues(keys: Record<string, StringKey>, t: Translate): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).map(([option, key]) => [option, t(key)]));
}

/** Délai lisible : « 45 s », « 2 min », « 1 h 30 ». */
export function formatDelay(seconds: number, t: Translate): string {
  if (seconds < 60) return t("d_s", { n: Math.round(seconds) });
  if (seconds < 3600 || seconds % 3600 !== 0) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("d_min", { n: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${t("d_h", { n: h })} ${String(m).padStart(2, "0")}` : t("d_h", { n: h });
  }
  return t("d_h", { n: seconds / 3600 });
}

/** « 120 » s → « 2 min », pour aider à lire les délais. */
export function humanDuration(value: number, unit: string | undefined, t: Translate): string | null {
  const seconds = unit === "s" ? value : unit === "min" ? value * 60 : null;
  if (seconds === null || seconds < 60 || (unit === "min" && seconds < 3600)) return null;
  if (seconds >= 3600 && seconds % 3600 === 0) return t("d_h", { n: seconds / 3600 });
  if (seconds % 60 === 0) return t("d_min", { n: seconds / 60 });
  return null;
}

export { translator };
