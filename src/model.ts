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
  | "room_state" | "apparent_temperature" | "auto_lights" | "auto_fans" | "forced_night"
  | "resume" | "lights_mode" | "night_start" | "night_end"
  | "lux_threshold" | "day_brightness" | "night_brightness" | "day_color_temp" | "night_color_temp"
  | "light_off_delay" | "night_light_off_delay" | "light_warning_duration" | "daylight_off_lux"
  | "temperature_threshold" | "night_temperature_threshold" | "fan_min_speed" | "fan_speed_range"
  | "fan_off_delay" | "night_fan_off_delay" | "vacancy_confirmation" | "override_duration";

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
  action?: { kind: "resume" | "enable"; label: string };
}

export type AutoState = "auto" | "manual" | "paused";

export interface Pane {
  kind: "lights" | "fans";
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
}

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
    name, night: false, forcedNight: false, notes: [], panes: [], ambient: [], ticking: false, entities: room,
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
  const occupied = roomState.state !== "vacant";
  const lightsIds: string[] = a.lights ?? [];
  const fansIds: string[] = a.fans ?? [];
  const lightsAuto = autoState(hass, room.auto_lights, a.lights_override_until);
  const fansAuto = autoState(hass, room.auto_fans, a.fans_override_until);
  const clock = (d: Date) => formatClock(d, language);
  const countdown = (d: Date) => formatCountdown(d.getTime() - now.getTime());

  const lightsOffAt = parseDate(a.lights_off_at);
  const fansOffAt = parseDate(a.fans_off_at);
  const vacancyAt = parseDate(a.vacancy_at);
  const lightsManualUntil = parseDate(a.lights_override_until);
  const fansManualUntil = parseDate(a.fans_override_until);
  const forcedUntil = room.forced_night ? parseDate(hass.states[room.forced_night]?.attributes.until) : null;
  const forcedNight = isOn(hass, room.forced_night);

  const notes: string[] = [];
  let ticking = false;
  let line: NowLine;

  const hasLights = lightsIds.length > 0;
  const hasFans = fansIds.length > 0;
  const lightsManual = hasLights && lightsAuto === "manual";
  const fansManual = hasFans && fansAuto === "manual";
  const lightsPaused = hasLights && lightsAuto === "paused";
  const fansPaused = hasFans && fansAuto === "paused";

  if (a.lights_warning && lightsOffAt) {
    line = { text: t("warning", { t: countdown(lightsOffAt) }), icon: "timer", tone: "countdown" };
    notes.push(t("note_warning"));
    ticking = true;
  } else if (lightsManual || fansManual) {
    const until = [lightsManual ? lightsManualUntil : null, fansManual ? fansManualUntil : null]
      .filter((d): d is Date => d !== null)
      .sort((x, y) => x.getTime() - y.getTime())[0];
    const key: StringKey = lightsManual && fansManual ? "manual_both" : lightsManual ? "manual_lights" : "manual_fans";
    line = {
      text: t(key, { h: until ? clock(until) : "…" }),
      icon: "hand",
      tone: "manual",
      action: room.resume ? { kind: "resume", label: t("resume") } : undefined,
    };
  } else if (a.vacancy_pending && vacancyAt) {
    line = { text: t("vacancy", { t: countdown(vacancyAt) }), icon: "timerOutline", tone: "countdown" };
    ticking = true;
  } else if (!occupied && (lightsOffAt || fansOffAt)) {
    const lightsFirst = lightsOffAt && (!fansOffAt || lightsOffAt <= fansOffAt);
    if (lightsFirst && lightsOffAt) {
      line = { text: t("lights_off_in", { t: countdown(lightsOffAt) }), icon: "timerOutline", tone: "countdown" };
      if (fansOffAt) notes.push(t("fans_off_in", { t: countdown(fansOffAt) }));
    } else {
      line = { text: t("fans_off_in", { t: countdown(fansOffAt!) }), icon: "timerOutline", tone: "countdown" };
      if (lightsOffAt) notes.push(t("lights_off_in", { t: countdown(lightsOffAt) }));
    }
    ticking = true;
  } else if ((hasLights || hasFans) && (!hasLights || lightsPaused) && (!hasFans || fansPaused)) {
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
  if (forcedNight) notes.push(t("note_forced_night", { h: forcedUntil ? clock(forcedUntil) : "…" }));
  if (line.action?.kind !== "enable") {
    if (lightsPaused) notes.push(t("note_lights_paused"));
    if (fansPaused) notes.push(t("note_fans_paused"));
  }
  if (hasLights && a.daylight_locked) notes.push(t("note_daylight"));
  if (hasLights && night && !lightsPaused && num(hass, room.night_brightness) === 0) {
    notes.push(t("note_no_night_light"));
  }

  const panes: Pane[] = [];
  if (hasLights) panes.push(lightsPane(hass, room, a, t, lightsIds, lightsAuto, lightsManualUntil, night, language, clock, pending.lights));
  if (hasFans) panes.push(fansPane(hass, room, a, t, fansIds, fansAuto, fansManualUntil, night, language, clock, pending.fans));

  return {
    status: "ok",
    name,
    night,
    forcedNight,
    now: line,
    notes: notes.slice(0, 2),
    panes,
    ambient: config.hide_ambient ? [] : ambient(hass, room, a, t, language),
    ticking,
    entities: room,
  };
}

function autoState(hass: Hass, autoEntity: string | undefined, overrideUntil: unknown): AutoState {
  if (autoEntity && hass.states[autoEntity]?.state === "off") return "paused";
  if (overrideUntil) return "manual";
  return "auto";
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
  auto: AutoState, manualUntil: Date | null, night: boolean, language: string,
  clock: (d: Date) => string, pending: number | undefined,
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
  else if (auto === "manual") hint = t("hint_manual", { h: manualUntil ? clock(manualUntil) : "…" });
  else if (on) {
    const delay = num(hass, night ? room.night_light_off_delay ?? room.light_off_delay : room.light_off_delay);
    hint = delay !== null ? t("hint_lights_off_after", { d: formatDelay(delay, t) }) : t("hint_auto_on");
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
  auto: AutoState, manualUntil: Date | null, night: boolean, language: string,
  clock: (d: Date) => string, pending: number | undefined,
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
  else if (auto === "manual") hint = t("hint_manual", { h: manualUntil ? clock(manualUntil) : "…" });
  else if (on) {
    if (a.temperature_sensor && threshold !== null) {
      // Lumina arrête les ventilateurs 1 °C sous le seuil (hystérésis)
      hint = t(a.humidity_sensor ? "hint_fans_stop_below_apparent" : "hint_fans_stop_below", {
        v: formatNumber(threshold - 1, language, 1),
      });
    } else {
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
}

export interface SettingTab {
  id: "lights" | "fans" | "night" | "presence";
  label: string;
  icon: IconName;
  rows: SettingRow[];
}

const TABS: { id: SettingTab["id"]; label: StringKey; icon: IconName; rows: [LuminaKey, SettingKind, StringKey, StringKey?][] }[] = [
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
      ["lights_mode", "select", "s_lights_mode"],
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
    ],
  },
  {
    id: "night", label: "tab_night", icon: "moon", rows: [
      ["forced_night", "switch", "s_forced_night", "h_forced_night"],
      ["night_start", "time", "s_night_start", "h_night_window"],
      ["night_end", "time", "s_night_end"],
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
      .map(([key, kind, label, help]) => ({
        key, entity: room[key]!, kind, label: t(label), help: help ? t(help) : undefined,
      })),
  })).filter((tab) => tab.rows.length > 0);
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
