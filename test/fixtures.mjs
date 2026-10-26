// Faux objet `hass` reproduisant une pièce Lumina 0.8, partagé par les tests
// et par la page de démonstration. La clim est facultative (`climate: true`),
// comme le sommeil de Lumina 0.10 (`sleep: true`).

export const DEVICE = "dev_chambre";

const ROOM = "sensor.lumina_chambre_etat";
const KEYS = {
  room_state: ROOM,
  apparent_temperature: "sensor.lumina_chambre_ressentie",
  auto_lights: "switch.lumina_chambre_auto_lumieres",
  auto_fans: "switch.lumina_chambre_auto_ventilateurs",
  forced_night: "switch.lumina_chambre_nuit_maintenant",
  resume: "button.lumina_chambre_reprendre",
  lights_mode: "select.lumina_chambre_lumieres_a_allumer",
  fans_mode: "select.lumina_chambre_ventilateurs_a_allumer",
  night_override_until_morning: "switch.lumina_chambre_manuel_jusqu_au_matin",
  night_start: "time.lumina_chambre_debut_nuit",
  night_end: "time.lumina_chambre_fin_nuit",
  lux_threshold: "number.lumina_chambre_seuil_lux",
  day_brightness: "number.lumina_chambre_luminosite_jour",
  night_brightness: "number.lumina_chambre_luminosite_nuit",
  light_off_delay: "number.lumina_chambre_delai_lumieres",
  temperature_threshold: "number.lumina_chambre_seuil_temperature",
  fan_min_speed: "number.lumina_chambre_vitesse_min",
  vacancy_confirmation: "number.lumina_chambre_confirmation",
  override_duration: "number.lumina_chambre_duree_manuel",
  auto_climate: "switch.lumina_chambre_auto_clim",
  climate_vacant_day: "select.lumina_chambre_clim_vide_jour",
  climate_vacant_night: "select.lumina_chambre_clim_vide_nuit",
  climate_vacant_delay: "number.lumina_chambre_delai_clim",
  fans_with_climate: "select.lumina_chambre_ventilateurs_pendant_clim",
  fan_mix_speed: "number.lumina_chambre_vitesse_brassage",
  sleeping: "switch.lumina_chambre_sommeil",
  bedtime_gesture: "select.lumina_chambre_extinction_nuit",
  sleep_brightness: "number.lumina_chambre_veilleuse",
  // Lumina 0.11, présentes seulement avec leur source (Workday, calendrier)
  night_end_day_off: "time.lumina_chambre_fin_nuit_repos",
  night_end_holidays: "time.lumina_chambre_fin_nuit_vacances",
  // Lumina 0.13
  evening_start: "time.lumina_chambre_debut_soiree",
  evening_brightness: "number.lumina_chambre_luminosite_soiree",
  evening_color_temp: "number.lumina_chambre_teinte_soiree",
};

const CLIMATE_ACTIONS = ["off", "eco", "setback", "none"];

const number = (state, unit, min, max, step) => ({
  state: String(state),
  attributes: { unit_of_measurement: unit, min, max, step, mode: "box" },
});

/**
 * Construit une pièce. `room` complète les attributs du capteur d'état,
 * `states` remplace ou ajoute des états.
 */
export function makeHass({ room = {}, states = {}, language = "fr", calls = [], climate = false, sleep = false } = {}) {
  // Lumina 0.10 : sommeil, select du geste à la place du switch « jusqu'au matin »
  const sleepStates = sleep
    ? {
        [KEYS.sleeping]: { state: room.sleeping ? "on" : "off", attributes: { until: room.sleeping_until ?? null } },
        [KEYS.bedtime_gesture]: {
          state: room.bedtime_gesture ?? "until_vacant",
          attributes: { options: ["override", "until_vacant", "until_wake"] },
        },
        [KEYS.sleep_brightness]: number(0, "%", 0, 100, 1),
        [KEYS.night_override_until_morning]: null,
      }
    : {};
  const sleepRoom = sleep
    ? {
        sleeping: false, sleeping_until: null, sleep_source: null, sleep_presence_seen: false,
        presumed_occupied: false, sleep_entity: null, bedtime_gesture: "until_vacant", lights_held: false,
        overrides_until_wake: [], overrides_until_morning: [],
      }
    : {};
  const climateStates = climate
    ? {
        [KEYS.auto_climate]: { state: "on", attributes: {} },
        [KEYS.climate_vacant_day]: { state: "off", attributes: { options: CLIMATE_ACTIONS } },
        [KEYS.climate_vacant_night]: { state: "none", attributes: { options: CLIMATE_ACTIONS } },
        [KEYS.climate_vacant_delay]: number(900, "s", 0, 7200, 60),
        [KEYS.fans_with_climate]: { state: "normal", attributes: { options: ["normal", "mix", "off"] } },
        [KEYS.fan_mix_speed]: number(33, "%", 10, 100, 1),
        "climate.chambre": {
          state: "cool",
          attributes: {
            temperature: 24, current_temperature: 26.5, min_temp: 16, max_temp: 30, target_temp_step: 0.5,
            hvac_modes: ["off", "cool", "heat", "dry", "fan_only"], preset_mode: "none", preset_modes: ["none", "eco"],
            friendly_name: "Clim chambre",
          },
        },
      }
    : {};
  const climateRoom = climate
    ? {
        climates: ["climate.chambre"],
        climate_override_until: null,
        climate_running: true,
        climate_vacant_action: "off",
        climate_vacant_at: null,
        climate_vacant_applied: null,
        fans_with_climate: "normal",
      }
    : { climates: [] };
  const base = {
    [ROOM]: {
      state: "occupied",
      attributes: {
        period: "day",
        forced_night: false,
        occupied: true,
        vacancy_pending: false,
        vacancy_at: null,
        presence_hold_active: false,
        lights_override_until: null,
        fans_override_until: null,
        lights_off_at: null,
        fans_off_at: null,
        lights_warning: false,
        daylight_locked: false,
        presence_sensors: ["binary_sensor.fp2_chambre"],
        presence_hold_entities: ["media_player.tv_chambre"],
        illuminance_sensor: "sensor.lux_chambre",
        temperature_sensor: "sensor.temp_chambre",
        humidity_sensor: "sensor.humidite_chambre",
        lights: ["light.chambre"],
        fans: ["fan.chambre"],
        lights_mode: "all",
        fans_mode: "all",
        ...climateRoom,
        ...sleepRoom,
        ...room,
      },
    },
    [KEYS.apparent_temperature]: { state: "29.4", attributes: { unit_of_measurement: "°C" } },
    [KEYS.auto_lights]: { state: "on", attributes: {} },
    [KEYS.auto_fans]: { state: "on", attributes: {} },
    [KEYS.forced_night]: { state: "off", attributes: { until: null } },
    [KEYS.resume]: { state: "unknown", attributes: {} },
    [KEYS.lights_mode]: { state: "all", attributes: { options: ["all", "any"] } },
    [KEYS.fans_mode]: { state: "all", attributes: { options: ["all", "any"] } },
    [KEYS.night_override_until_morning]: { state: "on", attributes: {} },
    [KEYS.night_start]: { state: "22:00:00", attributes: {} },
    [KEYS.night_end]: { state: "07:00:00", attributes: {} },
    [KEYS.lux_threshold]: number(50, "lx", 0, 2000, 5),
    [KEYS.day_brightness]: number(100, "%", 1, 100, 1),
    [KEYS.night_brightness]: number(30, "%", 0, 100, 1),
    [KEYS.light_off_delay]: number(120, "s", 0, 3600, 10),
    [KEYS.temperature_threshold]: number(28, "°C", 18, 35, 0.5),
    [KEYS.fan_min_speed]: number(33, "%", 0, 100, 1),
    [KEYS.vacancy_confirmation]: number(30, "s", 0, 600, 5),
    [KEYS.override_duration]: number(30, "min", 0, 240, 5),
    "binary_sensor.fp2_chambre": { state: "on", attributes: { friendly_name: "Présence chambre" } },
    "media_player.tv_chambre": { state: "off", attributes: { friendly_name: "TV Chambre" } },
    "sensor.lux_chambre": { state: "38", attributes: { unit_of_measurement: "lx" } },
    "sensor.temp_chambre": { state: "27.6", attributes: { unit_of_measurement: "°C" } },
    "sensor.humidite_chambre": { state: "78", attributes: { unit_of_measurement: "%" } },
    "light.chambre": {
      state: "on",
      attributes: { brightness: 179, supported_color_modes: ["color_temp"], friendly_name: "Lumière chambre" },
    },
    "fan.chambre": { state: "on", attributes: { percentage: 66, percentage_step: 33, friendly_name: "Ventilateur" } },
  };

  const all = { ...base, ...climateStates, ...sleepStates, ...states };
  const hassStates = {};
  for (const [entity_id, value] of Object.entries(all)) {
    if (value) hassStates[entity_id] = { entity_id, ...value };
  }

  const entities = {};
  for (const [key, entity_id] of Object.entries(KEYS)) {
    if (hassStates[entity_id]) {
      entities[entity_id] = { entity_id, device_id: DEVICE, platform: "lumina", translation_key: key, area_id: null };
    }
  }

  return {
    states: hassStates,
    entities,
    devices: { [DEVICE]: { id: DEVICE, name: "Lumina", area_id: "chambre" } },
    areas: { chambre: { area_id: "chambre", name: "Chambre Parents" } },
    language,
    locale: { language },
    async callService(domain, service, data) {
      calls.push({ domain, service, data });
    },
  };
}

export const ENTITIES = KEYS;
