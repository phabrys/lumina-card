// Logique de la carte, sans DOM : retrouve les entités d'une pièce Lumina et
// calcule ce qui doit être affiché à un instant donné. Tout ce qui est décidé
// ici est couvert par les tests (test/model.test.mjs).

import type { IconName } from "./icons.js";
import { translator, type StringKey, type Translate } from "./i18n.js";

// --- Types minimaux de Home Assistant ----------------------------------------

/** Attributs d'entité lus par la carte ; les autres restent de type inconnu. */
export interface HassAttributes {
  [key: string]: unknown;
  friendly_name?: string;
  unit_of_measurement?: string;
  // Lumière
  brightness?: number;
  color_mode?: string;
  color_temp_kelvin?: number;
  supported_color_modes?: string[];
  // Ventilateur
  percentage?: number;
  percentage_step?: number;
  // Clim
  preset_mode?: string;
  temperature?: number;
  min_temp?: number;
  max_temp?: number;
  target_temp_step?: number;
  // Réglages Lumina (number, select) et switch de nuit forcée
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  until?: string | null;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassAttributes;
  last_changed?: string;
}

/**
 * Attributs du capteur d'état d'une pièce, publiés par l'intégration Lumina
 * (`RoomController.attributes`). Tous facultatifs : une version plus ancienne
 * de Lumina n'en publie qu'une partie. Les dates sont des textes ISO.
 */
export interface RoomStateAttributes extends HassAttributes {
  period?: "day" | "evening" | "night";
  occupied?: boolean;
  sleeping?: boolean;
  sleeping_until?: string | null;
  sleep_source?: string | null;
  sleep_entity?: string | null;
  presumed_occupied?: boolean;
  bedtime_gesture?: string;
  lights_held?: boolean;
  wake_hold_until?: string | null;
  daylight_locked?: boolean;
  vacancy_pending?: boolean;
  vacancy_at?: string | null;
  presence_hold_active?: boolean;
  presence_unknown?: boolean;
  lights_warning?: boolean;
  lights_off_at?: string | null;
  fans_off_at?: string | null;
  lights_override_until?: string | null;
  fans_override_until?: string | null;
  climate_override_until?: string | null;
  /** Groupes en contrôle manuel jusqu'au réveil (Lumina 0.10). */
  overrides_until_wake?: string[];
  /** Ancien nom de `overrides_until_wake` (Lumina 0.9.2). */
  overrides_until_morning?: string[];
  climate_running?: boolean;
  climate_vacant_action?: string;
  climate_vacant_at?: string | null;
  climate_vacant_applied?: string | null;
  fans_with_climate?: string;
  // Entités de la pièce
  presence_sensors?: string[];
  presence_hold_entities?: string[];
  illuminance_sensor?: string | null;
  temperature_sensor?: string | null;
  humidity_sensor?: string | null;
  lights?: string[];
  fans?: string[];
  climates?: string[];
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
  /** Groupes sans panneau sur cette carte (Lumina continue de les gérer). */
  hide_panes?: PaneKind[];
  /** Pas de roue dentée : réglages inaccessibles depuis cette carte. */
  hide_settings?: boolean;
  /** Panneaux réduits à une pastille : icône et valeur, sans curseur ni indication. */
  compact?: boolean;
}

// --- Entités d'une pièce -----------------------------------------------------

/** Clés de traduction des entités Lumina, telles que définies par l'intégration. */
export type LuminaKey =
  | "room_state"
  | "apparent_temperature"
  | "auto_lights"
  | "auto_fans"
  | "auto_climate"
  | "forced_night"
  | "resume"
  | "lights_mode"
  | "fans_mode"
  | "night_start"
  | "night_end"
  | "night_override_until_morning"
  | "lux_threshold"
  | "day_brightness"
  | "night_brightness"
  | "day_color_temp"
  | "night_color_temp"
  | "light_off_delay"
  | "night_light_off_delay"
  | "light_warning_duration"
  | "daylight_off_lux"
  | "temperature_threshold"
  | "night_temperature_threshold"
  | "fan_min_speed"
  | "fan_speed_range"
  | "fan_off_delay"
  | "night_fan_off_delay"
  | "vacancy_confirmation"
  | "override_duration"
  | "climate_vacant_day"
  | "climate_vacant_night"
  | "climate_vacant_delay"
  | "fans_with_climate"
  | "fan_mix_speed"
  | "sleeping"
  | "bedtime_gesture"
  | "sleep_brightness"
  | "night_end_day_off"
  | "night_end_holidays"
  | "evening_start"
  | "evening_brightness"
  | "evening_color_temp"
  | "sunset_advance"
  | "sunrise_delay"
  | "evening_climate_temperature";

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

/** Pièces déjà résolues, par registre : Home Assistant remplace l'objet
 * `hass.entities` à chaque changement du registre, pas à chaque changement d'état. */
const roomCache = new WeakMap<object, Map<string, RoomEntities>>();

/** Entités Lumina d'un appareil, indexées par clé de traduction. */
export function resolveRoom(hass: Hass, deviceId: string | undefined): RoomEntities {
  if (!deviceId) return {};
  const registry = hass.entities ?? {};
  let rooms = roomCache.get(registry);
  if (!rooms) roomCache.set(registry, (rooms = new Map<string, RoomEntities>()));
  let room = rooms.get(deviceId);
  if (room) return room;
  room = {};
  for (const entry of Object.values(registry)) {
    if (entry.platform === "lumina" && entry.device_id === deviceId && entry.translation_key) {
      room[entry.translation_key as LuminaKey] = entry.entity_id;
    }
  }
  rooms.set(deviceId, room);
  return room;
}

export function roomName(hass: Hass, config: CardConfig, room: RoomEntities): string {
  if (config.name) return config.name;
  const deviceId = deviceOf(hass, config);
  const device = deviceId ? hass.devices?.[deviceId] : undefined;
  const areaId = device?.area_id ?? (room.room_state ? hass.entities?.[room.room_state]?.area_id : undefined);
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
  /** Précision après le titre : teinte de la lumière (« 2 700 K »). */
  detail?: string;
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
  /** Capteur dont la fiche s'ouvre au toucher. */
  entity: string;
  value: string;
  detail?: string;
  title?: string;
}

export interface RoomView {
  status: "ok" | "missing" | "unavailable";
  name: string;
  night: boolean;
  /** Soirée : lumières plus douces, règles du jour pour le reste (Lumina 0.13). */
  evening: boolean;
  forcedNight: boolean;
  /** Pièce en sommeil (Lumina 0.10). */
  sleeping: boolean;
  now: NowLine;
  /** Notes par ordre d'importance ; la carte n'en montre que deux d'emblée. */
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
  const date = new Date(value);
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

/** Ce que les parties de l'affichage d'une pièce partagent. */
interface ViewContext {
  hass: Hass;
  room: RoomEntities;
  /** Attributs du capteur d'état de la pièce. */
  a: RoomStateAttributes;
  t: Translate;
  language: string;
  now: Date;
  night: boolean;
  /** Réglages de nuit : la nuit, ou en sommeil (sieste comprise). */
  nightRules: boolean;
  sleeping: boolean;
  occupied: boolean;
  /** Ventilateurs et clim ne s'arrêtent pas : un dormeur peut échapper au détecteur. */
  presumed: boolean;
  /** Contrôles manuels « jusqu'au réveil » (Lumina 0.10) plutôt que « jusqu'au matin ». */
  wake: boolean;
  clock: (date: Date) => string;
  countdown: (date: Date) => string;
}

/** Groupe d'appareils présent dans la pièce : lumières, ventilateurs ou clims. */
interface GroupState {
  kind: PaneKind;
  ids: string[];
  auto: AutoState;
  /** Fin du contrôle manuel, s'il y en a un. */
  until: Date | null;
  /** Nom du groupe dans une phrase (« lumière »). */
  word: string;
  /** Contrôle manuel tenu jusqu'au réveil (ou jusqu'au matin). */
  morning: boolean;
}

/** Échéance en pièce vide (extinction, action sur la clim) et sa phrase. */
interface Scheduled {
  at: Date;
  text: (countdown: string) => string;
}

/** Phrase principale de la carte et notes qui l'accompagnent. */
interface NowState {
  line: NowLine;
  notes: string[];
  /** Vrai si un compte à rebours est affiché. */
  ticking: boolean;
}

/**
 * Calcule l'affichage d'une pièce. `now` est passé explicitement pour que les
 * comptes à rebours soient testables.
 */
export function buildView(hass: Hass, config: CardConfig, now: Date, pending: Pending = {}): RoomView {
  const language = languageOf(hass);
  const t = translator(language);
  const room = resolveRoom(hass, deviceOf(hass, config));
  const name = roomName(hass, config, room);
  const empty: Omit<RoomView, "status" | "now"> = {
    name,
    night: false,
    evening: false,
    forcedNight: false,
    sleeping: false,
    notes: [],
    panes: [],
    ambient: [],
    ticking: false,
    entities: room,
  };

  if (!room.room_state) {
    return { ...empty, status: "missing", now: { text: t("missing"), icon: "alert", tone: "alert" } };
  }
  const roomState = hass.states[room.room_state];
  if (!roomState || roomState.state === "unavailable" || roomState.state === "unknown") {
    return { ...empty, status: "unavailable", now: { text: t("unavailable"), icon: "alert", tone: "alert" } };
  }

  const ctx = viewContext(hass, room, roomState, t, language, now);
  const groups = groupStates(ctx);
  const { line, notes, ticking } = nowState(ctx, groups, vacantSchedule(ctx));
  // Un détecteur muet passe devant tout : la pièce ne peut plus être suivie correctement.
  const sensorNote = deadSensorsNote(ctx);

  return {
    status: "ok",
    name,
    night: ctx.night,
    evening: ctx.a.period === "evening",
    forcedNight: isOn(hass, room.forced_night),
    sleeping: ctx.sleeping,
    now: line,
    notes: [...(sensorNote ? [sensorNote] : []), ...notes, ...secondaryNotes(ctx, groups, line)],
    panes: buildPanes(ctx, groups, config, pending),
    ambient: config.hide_ambient ? [] : ambient(ctx),
    ticking,
    entities: room,
  };
}

function viewContext(
  hass: Hass,
  room: RoomEntities,
  roomState: HassEntity,
  t: Translate,
  language: string,
  now: Date,
): ViewContext {
  const a: RoomStateAttributes = roomState.attributes;
  const night = a.period === "night";
  // En sommeil, Lumina applique les réglages de nuit, sieste comprise.
  const sleeping = a.sleeping === true;
  return {
    hass,
    room,
    a,
    t,
    language,
    now,
    night,
    nightRules: night || sleeping,
    sleeping,
    // « En sommeil » et « Contrôle manuel » ne disent pas si la pièce est occupée.
    occupied: typeof a.occupied === "boolean" ? a.occupied : roomState.state !== "vacant",
    presumed: sleeping && a.presumed_occupied === true,
    wake: Array.isArray(a.overrides_until_wake),
    clock: (date) => formatClock(date, language),
    countdown: (date) => formatCountdown(date.getTime() - now.getTime()),
  };
}

/** Groupes présents dans la pièce, avec leur automatisme et leur contrôle manuel. */
function groupStates(ctx: ViewContext): GroupState[] {
  const { hass, room, a, t, night, wake } = ctx;
  // Contrôles manuels « jusqu'au réveil » (Lumina 0.10), « jusqu'au matin »
  // publiés depuis 0.9.2, déduits de l'heure de fin de nuit avant.
  const morningKinds = wake ? a.overrides_until_wake : a.overrides_until_morning;
  const untilMorning = (kind: PaneKind, until: Date | null): boolean =>
    Array.isArray(morningKinds)
      ? morningKinds.includes(kind)
      : night && isOn(hass, room.night_override_until_morning) && !!until && isNightEnd(hass, room.night_end, until);
  const specs: { kind: PaneKind; ids?: string[]; autoEntity?: string; overrideUntil?: string | null; word: string }[] =
    [
      {
        kind: "lights",
        ids: a.lights,
        autoEntity: room.auto_lights,
        overrideUntil: a.lights_override_until,
        word: t("w_lights"),
      },
      {
        kind: "fans",
        ids: a.fans,
        autoEntity: room.auto_fans,
        overrideUntil: a.fans_override_until,
        word: t("w_fans"),
      },
      {
        kind: "climate",
        ids: a.climates,
        autoEntity: room.auto_climate,
        overrideUntil: a.climate_override_until,
        word: t("w_climate"),
      },
    ];
  return specs
    .filter((spec) => spec.ids?.length)
    .map(({ kind, ids, autoEntity, overrideUntil, word }) => {
      const auto = autoState(hass, autoEntity, overrideUntil);
      const until = parseDate(overrideUntil);
      return { kind, ids: ids ?? [], auto, until, word, morning: auto === "manual" && untilMorning(kind, until) };
    });
}

/** Échéances en pièce vide, de la plus proche à la plus lointaine : extinctions, puis action sur la clim. */
function vacantSchedule(ctx: ViewContext): Scheduled[] {
  const { hass, a, t } = ctx;
  const scheduled: Scheduled[] = [];
  const lightsOffAt = parseDate(a.lights_off_at);
  const fansOffAt = parseDate(a.fans_off_at);
  const climateAt = parseDate(a.climate_vacant_at);
  if (lightsOffAt) scheduled.push({ at: lightsOffAt, text: (d) => t("lights_off_in", { t: d }) });
  if (fansOffAt) scheduled.push({ at: fansOffAt, text: (d) => t("fans_off_in", { t: d }) });
  const climateIds = a.climates ?? [];
  const climateOn = climateIds.some((id) => isClimateOn(hass.states[id]));
  const action = a.climate_vacant_action;
  if (climateAt && climateOn && action && action !== "none") {
    const heating = climateIds.some((id) => hass.states[id]?.state === "heat");
    const key: StringKey =
      action === "off"
        ? "climate_off_in"
        : action === "eco"
          ? "climate_eco_in"
          : heating
            ? "climate_setback_heat_in"
            : "climate_setback_in";
    scheduled.push({ at: climateAt, text: (d) => t(key, { t: d }) });
  }
  return scheduled.sort((x, y) => x.at.getTime() - y.at.getTime());
}

/** Phrase principale : la situation la plus importante de la pièce, avec ses notes. */
function nowState(ctx: ViewContext, groups: GroupState[], scheduled: Scheduled[]): NowState {
  const { hass, a, t, night, occupied, countdown } = ctx;
  const lightsOffAt = parseDate(a.lights_off_at);
  const vacancyAt = parseDate(a.vacancy_at);
  const manual = groups.filter((g) => g.auto === "manual");

  if (a.lights_warning && lightsOffAt) {
    return {
      line: { text: t("warning", { t: countdown(lightsOffAt) }), icon: "timer", tone: "countdown" },
      notes: [t("note_warning")],
      ticking: true,
    };
  }
  if (ctx.sleeping) return sleepState(ctx, manual, scheduled);
  if (manual.length) return { line: manualLine(ctx, manual), notes: [], ticking: false };
  if (a.vacancy_pending && vacancyAt) {
    return {
      line: { text: t("vacancy", { t: countdown(vacancyAt) }), icon: "timerOutline", tone: "countdown" },
      notes: [],
      ticking: true,
    };
  }
  if (!occupied && scheduled.length) {
    const [first, ...rest] = scheduled;
    return {
      line: { text: first.text(countdown(first.at)), icon: "timerOutline", tone: "countdown" },
      notes: rest.map((next) => next.text(countdown(next.at))),
      ticking: true,
    };
  }
  if (groups.length && groups.every((g) => g.auto === "paused")) {
    return {
      line: { text: t("paused"), icon: "pause", tone: "calm", action: { kind: "enable", label: t("enable") } },
      notes: [],
      ticking: false,
    };
  }
  // Pièce gardée occupée par une entité de maintien (TV…), sans détecteur actif
  if (occupied && a.presence_hold_active && !(a.presence_sensors ?? []).some((e) => isOn(hass, e))) {
    const holder = (a.presence_hold_entities ?? []).find((e) => {
      const state = hass.states[e];
      return state && !HOLD_INACTIVE.has(state.state);
    });
    return {
      line: { text: t("hold", { name: holder ? friendly(hass, holder) : "…" }), icon: "tv", tone: "occupied" },
      notes: [],
      ticking: false,
    };
  }
  const line: NowLine = occupied
    ? night
      ? { text: t("occupied_night"), icon: "moon", tone: "night" }
      : { text: t("occupied"), icon: "account", tone: "occupied" }
    : night
      ? { text: t("vacant_night"), icon: "moon", tone: "night" }
      : { text: t("vacant"), icon: "home", tone: "calm" };
  return { line, notes: [], ticking: false };
}

/** En sommeil : jusqu'à quand, lampes allumées à la main, prochaine extinction, dormeur présumé. */
function sleepState(ctx: ViewContext, manual: GroupState[], scheduled: Scheduled[]): NowState {
  const { hass, room, a, t, occupied, presumed, clock, countdown } = ctx;
  const sleepingUntil = parseDate(a.sleeping_until);
  const line: NowLine = {
    text: sleepingUntil ? t("sleeping", { h: clock(sleepingUntil) }) : t("sleeping_plain"),
    icon: "sleep",
    tone: "night",
    action: room.sleeping ? { kind: "wake", label: t("wake") } : undefined,
  };
  const notes: string[] = [];
  let ticking = false;
  // Une lampe allumée à la main garde la durée réglée, puis s'éteint.
  const timed = manual.filter((g) => !g.morning);
  const until = earliest(timed.map((g) => g.until));
  if (until) notes.push(t("manual", { what: groupWords(timed, t), h: clock(until) }));
  if (!occupied && scheduled.length) {
    notes.push(scheduled[0].text(countdown(scheduled[0].at)));
    ticking = true;
  }
  const hasFansOrClimate = !!(a.fans?.length || a.climates?.length);
  if (presumed && !occupied && hasFansOrClimate) notes.push(t("note_presumed"));
  else if (a.sleep_source === "lights_off" && a.bedtime_gesture === "until_vacant") {
    notes.push(t("note_sleep_until_vacant"));
  } else if (a.sleep_source === "entity" && a.sleep_entity) {
    notes.push(t("note_sleep_entity", { name: friendly(hass, a.sleep_entity) }));
  }
  return { line, notes, ticking };
}

/**
 * Contrôle manuel : les groupes à durée réglée d'abord, avec leur échéance la
 * plus proche, puis ceux qui tiennent jusqu'au matin (ou au réveil).
 */
function manualLine(ctx: ViewContext, manual: GroupState[]): NowLine {
  const { room, t, wake, clock } = ctx;
  const timed = manual.filter((g) => !g.morning);
  const morning = manual.filter((g) => g.morning);
  const until = earliest((timed.length ? timed : morning).map((g) => g.until));
  const h = until ? clock(until) : "…";
  let text: string;
  if (!timed.length) {
    text = t(wake ? "manual_wake" : "manual_morning", { what: groupWords(morning, t), h });
  } else if (morning.length) {
    text = t(wake ? "manual_mixed_wake" : "manual_mixed", {
      what: groupWords(timed, t),
      h,
      rest: groupWords(morning, t).toLowerCase(),
    });
  } else {
    text = t("manual", { what: groupWords(timed, t), h });
  }
  return {
    text,
    icon: "hand",
    tone: "manual",
    action: room.resume ? { kind: "resume", label: t("resume") } : undefined,
  };
}

/** Notes secondaires, par ordre d'importance, après celles de la phrase principale. */
function secondaryNotes(ctx: ViewContext, groups: GroupState[], line: NowLine): string[] {
  const { hass, room, a, t, night, sleeping, occupied, clock } = ctx;
  const has = (kind: PaneKind) => groups.some((g) => g.kind === kind);
  const paused = (kind: PaneKind) => groups.some((g) => g.kind === kind && g.auto === "paused");
  const notes: string[] = [];
  if (room.forced_night && isOn(hass, room.forced_night)) {
    const until = parseDate(hass.states[room.forced_night]?.attributes.until);
    notes.push(t("note_forced_night", { h: until ? clock(until) : "…" }));
  }
  // La phrase « tout est en pause » le dit déjà
  if (line.action?.kind !== "enable") {
    if (paused("lights")) notes.push(t("note_lights_paused"));
    if (paused("fans")) notes.push(t("note_fans_paused"));
    if (paused("climate")) notes.push(t("note_climate_paused"));
  }
  const applied = has("climate") && !occupied ? a.climate_vacant_applied : null;
  if (applied === "off") notes.push(t("note_climate_off"));
  else if (applied === "eco") notes.push(t("note_climate_eco"));
  else if (applied === "setback") notes.push(t("note_climate_setback"));
  if (has("lights") && a.daylight_locked) notes.push(t(a.illuminance_sensor ? "note_daylight" : "note_sun_up"));
  if (has("lights") && a.lights_held && !paused("lights")) {
    // Répit du réveil : jusqu'à une heure précise depuis Lumina 0.10.2
    const held = parseDate(a.wake_hold_until);
    notes.push(held ? t("note_lights_held_until", { h: clock(held) }) : t("note_lights_held"));
  }
  if (has("lights") && night && !sleeping && !paused("lights") && num(hass, room.night_brightness) === 0) {
    notes.push(t("note_no_night_light"));
  }
  return notes;
}

/**
 * Un panneau par groupe, sauf pour un groupe que Lumina ne gère plus
 * (automatisme en pause) ou masqué dans la configuration de la carte.
 */
function buildPanes(ctx: ViewContext, groups: GroupState[], config: CardConfig, pending: Pending): Pane[] {
  const { t, wake, clock } = ctx;
  const builders = { lights: lightsPane, fans: fansPane, climate: climatePane };
  return groups
    .filter((g) => g.auto !== "paused" && !config.hide_panes?.includes(g.kind))
    .map((g) => {
      const manualHint = g.morning
        ? t(wake ? "hint_manual_wake" : "hint_manual_morning")
        : t("hint_manual", { h: g.until ? clock(g.until) : "…" });
      return builders[g.kind](ctx, g, manualHint, pending[g.kind]);
    });
}

/** Date la plus proche, undefined si aucune. */
function earliest(dates: (Date | null)[]): Date | undefined {
  return dates.filter((d): d is Date => d !== null).sort((x, y) => x.getTime() - y.getTime())[0];
}

/** « Lumière et ventilateur » : les groupes nommés dans une phrase. */
function groupWords(groups: GroupState[], t: Translate): string {
  return joinWords(
    groups.map((g) => g.word),
    t("w_and"),
  );
}

/**
 * Détecteurs de présence muets (piles, connexion) : depuis quand, et ce que
 * Lumina en fait. Tous muets, il garde la pièce occupée ou, depuis Lumina
 * 0.12, n'éteint plus rien.
 */
function deadSensorsNote(ctx: ViewContext): string | null {
  const { hass, a, occupied, t, language, now } = ctx;
  const sensors: string[] = a.presence_sensors ?? [];
  const dead = sensors.filter((e) => {
    const state = hass.states[e];
    return !state || state.state === "unavailable" || state.state === "unknown";
  });
  if (!dead.length) return null;
  const changes = dead
    .map((e) => parseDate(hass.states[e]?.last_changed))
    .filter((d): d is Date => d !== null)
    .sort((x, y) => x.getTime() - y.getTime());
  const since = changes.length ? formatSince(changes[0], now, language, t) : "";
  if (dead.length < sensors.length) {
    return t("note_sensor_dead", {
      name: joinWords(
        dead.map((e) => friendly(hass, e)),
        t("w_and"),
      ),
      since,
    });
  }
  const plural = sensors.length > 1;
  if (occupied) return t(plural ? "note_sensors_unavailable" : "note_sensor_unavailable", { since });
  if (a.presence_unknown === true) return t(plural ? "note_sensors_blind" : "note_sensor_blind", { since });
  return t(plural ? "note_sensors_dead" : "note_sensor_dead_plain", { since });
}

/** « depuis 14:05 » le jour même, « depuis le 15/10 » avant. */
function formatSince(date: Date, now: Date, language: string, t: Translate): string {
  if (date.toDateString() === now.toDateString()) return t("since_time", { h: formatClock(date, language) });
  return t("since_day", { d: date.toLocaleDateString(language, { day: "2-digit", month: "2-digit" }) });
}

/** « lumière, ventilateur et clim », avec une majuscule initiale. */
function joinWords(words: string[], and: string): string {
  const text =
    words.length > 1 ? `${words.slice(0, -1).join(", ")} ${and} ${words[words.length - 1]}` : (words[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** L'échéance tombe-t-elle à l'heure de fin de nuit ? (contrôle manuel « jusqu'au matin ») */
function isNightEnd(hass: Hass, nightEnd: string | undefined, until: Date): boolean {
  const [h, m] = (nightEnd ? (hass.states[nightEnd]?.state ?? "") : "").split(":").map(Number);
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

function lightsPane(ctx: ViewContext, group: GroupState, manualHint: string, pending: number | undefined): Pane {
  const { hass, room, a, t, language, sleeping } = ctx;
  const night = ctx.nightRules;
  const { ids, auto } = group;
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
  if (ids.length > 1 && on && pending === undefined)
    value += ` · ${t("of_total", { n: onStates.length, total: ids.length })}`;

  // Teinte moyenne des lampes allumées en blanc, à la centaine de kelvins
  const kelvins = onStates
    .filter((s) => s?.attributes.color_mode === "color_temp" && typeof s.attributes.color_temp_kelvin === "number")
    .map((s) => s.attributes.color_temp_kelvin as number);
  const detail = kelvins.length
    ? `${formatNumber(Math.round(kelvins.reduce((x, y) => x + y, 0) / kelvins.length / 100) * 100, language)} K`
    : undefined;

  let hint: string;
  if (auto === "paused") hint = t("hint_paused");
  else if (auto === "manual") hint = manualHint;
  else if (on) {
    const delay = num(hass, night ? (room.night_light_off_delay ?? room.light_off_delay) : room.light_off_delay);
    hint = delay !== null ? t("hint_lights_off_after", { d: formatDelay(delay, t) }) : t("hint_auto_on");
  } else if (a.lights_held) {
    const held = parseDate(a.wake_hold_until);
    hint = held ? t("hint_lights_held_until", { h: formatClock(held, language) }) : t("hint_lights_held");
  } else if (sleeping) {
    const nightLight = num(hass, room.sleep_brightness);
    hint = nightLight
      ? t("hint_sleep_night_light", { v: formatNumber(nightLight, language) })
      : t("hint_no_sleep_light");
  } else if (a.daylight_locked) hint = t(a.illuminance_sensor ? "hint_daylight" : "hint_sun_up");
  else if (night && num(hass, room.night_brightness) === 0) hint = t("hint_no_night");
  else {
    const threshold = num(hass, room.lux_threshold);
    // Sans capteur de luminosité, Lumina 0.14 suit le soleil.
    hint =
      a.illuminance_sensor && threshold !== null
        ? t("hint_lights_below", { v: formatNumber(threshold, language) })
        : !a.illuminance_sensor && hass.states["sun.sun"]?.state === "above_horizon"
          ? sunsetHint(num(hass, room.sunset_advance), t)
          : t("hint_lights_auto");
  }

  return {
    kind: "lights",
    title: t("lights"),
    entities: ids,
    on,
    level,
    step: 1,
    value,
    detail,
    hint,
    auto,
    autoEntity: room.auto_lights,
  };
}

/** Sans capteur de luminosité, en journée : allumage avant le coucher du soleil (Lumina 0.15). */
function sunsetHint(advance: number | null, t: Translate): string {
  return advance ? t("hint_lights_before_sunset", { d: formatDelay(advance * 60, t) }) : t("hint_lights_after_sunset");
}

function fansPane(ctx: ViewContext, group: GroupState, manualHint: string, pending: number | undefined): Pane {
  const { hass, room, a, t, language, presumed } = ctx;
  const night = ctx.nightRules;
  const { ids, auto } = group;
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
  const threshold = num(
    hass,
    night ? (room.night_temperature_threshold ?? room.temperature_threshold) : room.temperature_threshold,
  );
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
      const delay = num(hass, night ? (room.night_fan_off_delay ?? room.fan_off_delay) : room.fan_off_delay);
      hint = delay !== null ? t("hint_fans_off_after", { d: formatDelay(delay, t) }) : t("hint_auto_on");
    }
  } else if (a.temperature_sensor) {
    hint =
      threshold === null
        ? t("hint_fans_presence")
        : t(a.humidity_sensor ? "hint_fans_at_apparent" : "hint_fans_at", { v: formatNumber(threshold, language, 1) });
  } else hint = t("hint_fans_presence");

  // Un tour toutes les 2,4 s à basse vitesse, 0,45 s à pleine vitesse
  const spin = on ? 2.4 - ((level ?? 60) / 100) * 1.95 : undefined;

  const step = Math.max(1, Number(states.find((s) => s?.attributes.percentage_step)?.attributes.percentage_step ?? 1));
  return {
    kind: "fans",
    title: t("fans"),
    entities: ids,
    on,
    level,
    step,
    value,
    hint,
    auto,
    autoEntity: room.auto_fans,
    spin,
  };
}

function climatePane(ctx: ViewContext, group: GroupState, manualHint: string, pending: number | undefined): Pane {
  const { hass, room, a, t, language, presumed } = ctx;
  const night = ctx.nightRules;
  const { ids, auto } = group;
  const states = ids.map((id) => hass.states[id]).filter((s): s is HassEntity => !!s);
  const active = states.filter(isClimateOn);
  const main = active[0] ?? states[0];
  const on = active.length > 0;
  const mode = on ? main.state : "off";

  let value = t("off");
  if (on) {
    const hvac: Record<string, StringKey> = {
      cool: "hvac_cool",
      heat: "hvac_heat",
      heat_cool: "hvac_auto",
      auto: "hvac_auto",
      dry: "hvac_dry",
      fan_only: "hvac_fan_only",
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
  // Lumina 0.16 : consigne de soirée, 0 = jamais allumée
  const evening = num(hass, room.evening_climate_temperature);
  if (auto === "paused") hint = t("hint_paused");
  else if (auto === "manual") hint = manualHint;
  else if (a.climate_vacant_applied) hint = t("hint_climate_restore");
  else if (!on) {
    hint = evening
      ? t("hint_climate_evening_on", { v: formatNumber(evening, language, 1) })
      : t("hint_climate_never_on");
  }
  // Lumina ne touche pas une clim en simple ventilation (depuis 0.9.0)
  else if (mode === "fan_only") hint = t("hint_climate_fan_only");
  // Pièce présumée occupée : aucune action en ton absence pendant le sommeil
  else if (presumed) hint = t("hint_climate_untouched_sleep");
  else if (!action || action === "none") hint = t(night ? "hint_climate_untouched_night" : "hint_climate_untouched");
  else if (delay === null) hint = t("hint_auto_on");
  else {
    const key: StringKey =
      action === "off"
        ? "hint_climate_off_after"
        : action === "eco"
          ? "hint_climate_eco_after"
          : "hint_climate_setback_after";
    hint = t(key, { d: formatDelay(delay, t) });
  }

  return {
    kind: "climate",
    title: t("climate"),
    entities: ids,
    on,
    level: null,
    step: 1,
    value,
    hint,
    auto,
    autoEntity: room.auto_climate,
    mode,
    setpoint,
  };
}

function ambient(ctx: ViewContext): AmbientItem[] {
  const { hass, room, a, t, language } = ctx;
  const items: AmbientItem[] = [];
  const measured = num(hass, a.temperature_sensor);
  const apparent = num(hass, room.apparent_temperature);
  if (apparent !== null && room.apparent_temperature) {
    items.push({
      icon: "thermometer",
      entity: room.apparent_temperature,
      value: `${formatNumber(apparent, language, 1)} °C`,
      detail: t("apparent"),
      title: measured !== null ? t("measured", { v: formatNumber(measured, language, 1) }) : undefined,
    });
  } else if (measured !== null && a.temperature_sensor) {
    items.push({
      icon: "thermometer",
      entity: a.temperature_sensor,
      value: `${formatNumber(measured, language, 1)} °C`,
    });
  }
  const humidity = num(hass, a.humidity_sensor);
  if (humidity !== null && a.humidity_sensor) {
    items.push({ icon: "water", entity: a.humidity_sensor, value: `${formatNumber(humidity, language)} %` });
  }
  const lux = num(hass, a.illuminance_sensor);
  if (lux !== null && a.illuminance_sensor) {
    items.push({ icon: "brightness", entity: a.illuminance_sensor, value: `${formatNumber(lux, language)} lx` });
  }
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
  off: "o_climate_off",
  eco: "o_climate_eco",
  setback: "o_climate_setback",
  none: "o_climate_none",
};
const FANS_WITH_CLIMATE: Record<string, StringKey> = { normal: "o_fans_normal", mix: "o_fans_mix", off: "o_fans_off" };
const BEDTIME: Record<string, StringKey> = {
  override: "o_bedtime_override",
  until_vacant: "o_bedtime_until_vacant",
  until_wake: "o_bedtime_until_wake",
};
const BEDTIME_HELP: Record<string, StringKey> = {
  override: "h_bedtime_override",
  until_vacant: "h_bedtime_until_vacant",
  until_wake: "h_bedtime_until_wake",
};

type RowSpec = [LuminaKey, SettingKind, StringKey, StringKey?, Record<string, StringKey>?, Record<string, StringKey>?];

const TABS: { id: SettingTab["id"]; label: StringKey; icon: IconName; rows: RowSpec[] }[] = [
  {
    id: "lights",
    label: "tab_lights",
    icon: "lightbulb",
    rows: [
      ["auto_lights", "switch", "s_auto"],
      ["lux_threshold", "number", "s_lux_threshold"],
      ["day_brightness", "number", "s_day_brightness"],
      // Lumina 0.13
      ["evening_brightness", "number", "s_evening_brightness"],
      ["night_brightness", "number", "s_night_brightness", "h_night_brightness"],
      ["day_color_temp", "number", "s_day_color_temp", "h_color_temp"],
      ["evening_color_temp", "number", "s_evening_color_temp", "h_color_temp"],
      ["night_color_temp", "number", "s_night_color_temp", "h_color_temp"],
      ["light_off_delay", "number", "s_light_off_delay"],
      ["night_light_off_delay", "number", "s_night_light_off_delay"],
      ["light_warning_duration", "number", "s_light_warning_duration", "h_light_warning_duration"],
      ["daylight_off_lux", "number", "s_daylight_off_lux", "h_daylight_off_lux"],
      // Lumina 0.15, pièce sans capteur de luminosité
      ["sunset_advance", "number", "s_sunset_advance", "h_sun_margin"],
      ["sunrise_delay", "number", "s_sunrise_delay", "h_sun_margin"],
      ["lights_mode", "select", "s_lights_mode", undefined, ALL_ANY],
    ],
  },
  {
    id: "fans",
    label: "tab_fans",
    icon: "fan",
    rows: [
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
    id: "climate",
    label: "tab_climate",
    icon: "climate",
    rows: [
      ["auto_climate", "switch", "s_auto"],
      ["climate_vacant_day", "select", "s_climate_vacant_day", "h_climate_vacant", CLIMATE_ACTIONS],
      ["climate_vacant_night", "select", "s_climate_vacant_night", "h_climate_vacant_night", CLIMATE_ACTIONS],
      ["climate_vacant_delay", "number", "s_climate_vacant_delay", "h_climate_vacant_delay"],
      // Lumina 0.16
      ["evening_climate_temperature", "number", "s_evening_climate_temperature", "h_evening_climate_temperature"],
      ["fans_with_climate", "select", "s_fans_with_climate", undefined, FANS_WITH_CLIMATE],
      ["fan_mix_speed", "number", "s_fan_mix_speed"],
    ],
  },
  {
    id: "night",
    label: "tab_night",
    icon: "moon",
    rows: [
      ["forced_night", "switch", "s_forced_night", "h_forced_night"],
      ["sleeping", "switch", "s_sleeping", "h_sleeping"],
      // Lumina 0.13
      ["evening_start", "time", "s_evening_start", "h_evening_window"],
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
    id: "presence",
    label: "tab_presence",
    icon: "presence",
    rows: [
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
        key,
        entity: room[key]!,
        kind,
        label: t(rowLabel(room, key, label)),
        help: help ? t(help) : undefined,
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

/** Durée lisible : « 45 s », « 2 min 30 s », « 15 min », « 1 h 30 ». */
export function formatDelay(seconds: number, t: Translate): string {
  const total = Math.round(seconds);
  if (total < 60) return t("d_s", { n: total });
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return sec ? `${t("d_min", { n: m })} ${t("d_s", { n: sec })}` : t("d_min", { n: m });
  }
  const minutes = Math.round(total / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${t("d_h", { n: h })} ${String(m).padStart(2, "0")}` : t("d_h", { n: h });
}

/** Réglage en secondes ou en minutes, en durée lisible (900 s → « 15 min ») ; null pour les autres unités. */
export function formatDuration(value: number, unit: string | undefined, t: Translate): string | null {
  const seconds = unit === "s" ? value : unit === "min" ? value * 60 : null;
  return seconds === null ? null : formatDelay(seconds, t);
}

export { translator };
