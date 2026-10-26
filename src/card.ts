// Élément <lumina-card> : rendu et interactions. La logique d'affichage
// (quoi montrer, quand) vit dans model.ts ; ce fichier ne fait que dessiner
// et transmettre les gestes à Home Assistant.

import { ICONS, type IconName } from "./icons.js";
import {
  buildView,
  formatDuration,
  languageOf,
  settingTabs,
  translator,
  type CardConfig,
  type Hass,
  type Pane,
  type PaneKind,
  type Pending,
  type RoomView,
  type SettingRow,
  type SettingTab,
  type Setpoint,
} from "./model.js";
import { STYLES } from "./styles.js";

const BaseElement: typeof HTMLElement =
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ?? (class {} as typeof HTMLElement);

/** Échappe un texte pour l'insérer dans du HTML. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svg(name: IconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

/**
 * Pas « confortable » pour un réglage : ~10 % de la valeur, sans dépasser
 * 1/40 de la plage, arrondi à 1, 2 ou 5 × 10ⁿ et au pas de l'entité.
 */
export function smartStep(value: number, step: number, min: number, max: number): number {
  const target = Math.max(step, Math.min(Math.abs(value) * 0.1, (max - min) / 40));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((m) => m * magnitude).find((n) => n >= target) ?? target;
  return Math.max(step, Math.round(nice / step) * step);
}

/** Pas des durées, ronds à l'horloge : 30 s, 5 min, 15 min… (en secondes). */
const DURATION_STEPS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * Pas d'un réglage en secondes ou en minutes : comme smartStep, mais pris
 * parmi des durées rondes, pour que la valeur se lise bien (« 2 min 30 s »).
 */
export function durationStep(value: number, step: number, min: number, max: number, unit: "s" | "min"): number {
  const scale = unit === "min" ? 60 : 1;
  const target = Math.max(step, Math.min(Math.abs(value) * 0.1, (max - min) / 40)) * scale;
  const nice = DURATION_STEPS.find((n) => n >= target && (n / scale) % step === 0);
  return nice !== undefined ? nice / scale : smartStep(value, step, min, max);
}

/** Arrondit au palier le plus proche ; 0 et 100 restent atteignables. */
export function snap(value: number, step: number): number {
  if (value >= 100 - step / 2) return 100;
  return Math.min(100, Math.max(0, Math.round(Math.round(value / step) * step)));
}

function formatValue(value: number, step: number, language: string): string {
  const digits = step < 1 ? Math.min(2, String(step).split(".")[1]?.length ?? 1) : 0;
  return value.toLocaleString(language, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/**
 * Tout ce qui est affiché sauf les textes de la phrase et des notes, où vivent
 * les comptes à rebours : si cette clé ne change pas d'une seconde à l'autre,
 * il suffit de mettre ces textes à jour.
 */
/**
 * Sélecteur qui retrouve un élément après un redessin, par ses attributs data-*
 * et son rôle : le focus du clavier ne se perd pas à chaque mise à jour.
 */
function focusSelector(element: Element | null): string | undefined {
  if (!element?.attributes) return undefined;
  const attrs = [...element.attributes]
    .filter((attr) => attr.name.startsWith("data-") || attr.name === "role")
    .map((attr) => `[${attr.name}="${CSS.escape(attr.value)}"]`);
  return attrs.length ? element.tagName.toLowerCase() + attrs.join("") : undefined;
}

/** Après ouverture ou fermeture des réglages, le focus passe au bouton qui fait l'inverse. */
const FOCUS_FALLBACK: Record<string, string> = {
  settings: '[data-action="close"]',
  close: '[data-action="settings"]',
};

const PANE_ICONS: Record<PaneKind, [IconName, IconName]> = {
  lights: ["lightbulb", "lightbulbOff"],
  fans: ["fan", "fanOff"],
  climate: ["climate", "climateOff"],
};

function paneIcon(pane: Pane): IconName {
  return PANE_ICONS[pane.kind][pane.on ? 0 : 1];
}

export function tickKey(view: RoomView): string {
  return JSON.stringify({ ...view, now: { ...view.now, text: "" }, notes: view.notes.length });
}

export class LuminaCard extends BaseElement {
  private _config?: CardConfig;
  private _hass?: Hass;
  private _view?: RoomView;
  private _signature: unknown[] = [];
  private _settingsOpen = false;
  /** Toutes les notes affichées, au lieu des deux premières. */
  private _notesOpen = false;
  private _tab: SettingTab["id"] | undefined;
  private _pending: Pending = {};
  private _pendingTimers: Partial<Record<keyof Pending, number>> = {};
  private _numbers = new Map<string, number>();
  private _numberTimers = new Map<string, number>();
  private _tick?: number;
  /** Ce qui est affiché, hors textes des comptes à rebours (voir tickKey). */
  private _drawnKey?: string;
  private _dragging?: { kind: "lights" | "fans"; slider: HTMLElement };
  private _setpointTimer?: number;
  private _root: ShadowRoot;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.addEventListener("click", (event) => this._onClick(event));
    this._root.addEventListener("change", (event) => this._onChange(event));
    this._root.addEventListener("pointerdown", (event) => this._onPointerDown(event as PointerEvent));
    this._root.addEventListener("keydown", (event) => this._onKeyDown(event as KeyboardEvent));
  }

  // --- API des cartes Lovelace --------------------------------------------

  static getConfigElement(): HTMLElement {
    return document.createElement("lumina-card-editor");
  }

  static getStubConfig(hass: Hass): CardConfig {
    const entry = Object.values(hass.entities ?? {}).find(
      (e) => e.platform === "lumina" && e.translation_key === "room_state" && e.device_id,
    );
    return { type: "custom:lumina-card", device: entry?.device_id ?? undefined };
  }

  setConfig(config: CardConfig): void {
    if (!config) throw new Error("Configuration invalide");
    this._config = { ...config };
    this._signature = [];
    this._render(true);
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this._render();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  getCardSize(): number {
    return this._settingsOpen ? 8 : this._config?.compact ? 2 : 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback(): void {
    this._render(true);
  }

  disconnectedCallback(): void {
    this._stopTick();
  }

  // --- Rendu ----------------------------------------------------------------

  /** États dont dépend l'affichage : on ne redessine que s'ils changent. */
  private _computeSignature(view: RoomView): unknown[] {
    const hass = this._hass!;
    const ids = new Set<string>(Object.values(view.entities).filter((e): e is string => !!e));
    const roomState = view.entities.room_state ? hass.states[view.entities.room_state] : undefined;
    const a = roomState?.attributes ?? {};
    for (const key of ["lights", "fans", "climates", "presence_sensors", "presence_hold_entities"]) {
      for (const id of (a[key] as string[] | undefined) ?? []) ids.add(id);
    }
    for (const key of ["illuminance_sensor", "temperature_sensor", "humidity_sensor", "sleep_entity"]) {
      if (a[key]) ids.add(a[key] as string);
    }
    return [languageOf(hass), ...[...ids].sort().map((id) => hass.states[id])];
  }

  private _render(force = false): void {
    if (!this._config || !this._hass || !this.isConnected) return;
    if (this._dragging) return; // ne pas casser un glisser en cours
    const view = buildView(this._hass, this._config, new Date(), this._pending);
    const signature = this._computeSignature(view);
    const changed =
      force ||
      signature.length !== this._signature.length ||
      signature.some((value, index) => value !== this._signature[index]);
    this._view = view;
    if (!changed) return;
    this._signature = signature;
    this._draw();
  }

  private _draw(): void {
    const view = this._view!;
    const t = translator(languageOf(this._hass!));
    const tabs = settingTabs(view.entities, t);
    const hasSettings = tabs.length > 0 && !this._config!.hide_settings;
    const body =
      this._settingsOpen && hasSettings && view.status === "ok"
        ? this._renderSettings(view, tabs)
        : this._renderMain(view, hasSettings);

    // Les champs de réglage en cours d'édition ne sont pas redessinés.
    const focused = this._root.activeElement as HTMLElement | null;
    if (focused?.matches?.("input")) return;

    const selector = focusSelector(focused);
    this._root.innerHTML = `<style>${STYLES}</style><ha-card>${body}</ha-card>`;
    if (selector) this._restoreFocus(selector, focused!.dataset.action);
    this._drawnKey = this._settingsOpen ? undefined : tickKey(view);
    if (view.ticking) this._startTick();
    else this._stopTick();
  }

  private _restoreFocus(selector: string, action: string | undefined): void {
    let target = this._root.querySelector<HTMLElement>(selector);
    if (!target && action && FOCUS_FALLBACK[action]) target = this._root.querySelector<HTMLElement>(FOCUS_FALLBACK[action]);
    // Bouton − / + désactivé en butée : le focus reste dans le même réglage
    if (target && (target as HTMLButtonElement).disabled) {
      target = target.parentElement?.querySelector<HTMLElement>("button:not(:disabled)") ?? null;
    }
    target?.focus({ preventScroll: true });
  }

  private _renderMain(view: RoomView, hasSettings: boolean): string {
    const t = translator(languageOf(this._hass!));
    const header = `
      <header class="head">
        <div class="name">${esc(view.name)}</div>
        ${view.status === "ok" ? (view.sleeping ? "" : this._renderPeriod(view)) + this._renderSleep(view) : ""}
        ${hasSettings && view.status === "ok"
          ? `<button class="icon-btn" data-action="settings" title="${esc(t("settings"))}" aria-label="${esc(t("settings"))}">${svg("cog")}</button>`
          : ""}
      </header>`;

    const now = view.now;
    const action = now.action
      ? `<button class="now-action" data-action="${now.action.kind}">${esc(now.action.label)}</button>`
      : "";
    // Un compte à rebours ne doit pas être lu à voix haute chaque seconde.
    const nowLine = `
      <div class="now" role="status" aria-live="${view.ticking ? "off" : "polite"}">
        <span class="now-icon">${svg(now.icon)}</span>
        <span class="now-text">${esc(now.text)}</span>
        ${action}
      </div>`;
    const shown = this._shownNotes(view);
    const toggle =
      view.notes.length > 2
        ? `<li class="notes-toggle"><button data-action="notes" aria-expanded="${this._notesOpen}"
            ${this._notesOpen ? "" : `aria-label="${esc(t("notes_more_label"))}"`}>${
              esc(this._notesOpen ? t("notes_less") : t("notes_more", { n: view.notes.length - shown.length }))
            }</button></li>`
        : "";
    const notes = view.notes.length
      ? `<ul class="notes">${shown.map((n) => `<li class="note">${esc(n)}</li>`).join("")}${toggle}</ul>`
      : "";

    if (view.status !== "ok") {
      return `<div class="card tone-alert">${header}${nowLine}</div>`;
    }

    const panes = view.panes.length
      ? this._config!.compact
        ? `<div class="panes compact">${view.panes.map((pane) => this._renderChip(pane, t)).join("")}</div>`
        : `<div class="panes">${view.panes.map((pane) => this._renderPane(pane, t)).join("")}</div>`
      : "";
    const ambient = view.ambient.length
      ? `<div class="ambient">${view.ambient
          .map(
            (item) =>
              `<button class="ambient-item" data-action="more-info" data-entity="${esc(item.entity)}"${
                item.title ? ` title="${esc(item.title)}"` : ""
              }>${svg(item.icon)}<b>${esc(item.value)}</b>${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</button>`,
          )
          .join("")}</div>`
      : "";

    return `<div class="card tone-${now.tone}">${header}${nowLine}${notes}${panes}${ambient}</div>`;
  }

  private _shownNotes(view: RoomView): string[] {
    return this._notesOpen ? view.notes : view.notes.slice(0, 2);
  }

  private _renderPeriod(view: RoomView): string {
    const t = translator(languageOf(this._hass!));
    const forcedEntity = view.entities.forced_night;
    const label = view.night ? t("night") : view.evening ? t("evening") : t("day");
    // Nuit naturelle : rien à basculer. Sinon : forcer ou annuler la nuit.
    const actionable = !!forcedEntity && (!view.night || view.forcedNight);
    const title = view.forcedNight ? t("day_now") : view.night ? label : t("night_now");
    return `<button class="period ${view.night ? "night" : ""} ${view.forcedNight ? "forced" : ""}"
        data-action="period" ${actionable ? "" : "disabled"} title="${esc(title)}" aria-label="${esc(title)}">
        ${svg(view.night ? "moon" : "sun")}<span>${esc(label)}</span>
      </button>`;
  }

  /** Bouton Sommeil (Lumina 0.10) : endort ou réveille la pièce. En sommeil, il
   * remplace la pastille Jour / Nuit : le sommeil suit déjà les réglages de nuit. */
  private _renderSleep(view: RoomView): string {
    if (!view.entities.sleeping) return "";
    const t = translator(languageOf(this._hass!));
    const title = view.sleeping ? t("wake_now") : t("sleep_now");
    return `<button class="period sleep ${view.sleeping ? "sleeping" : ""}" data-action="sleep"
        aria-pressed="${view.sleeping}" title="${esc(title)}" aria-label="${esc(title)}">
        ${svg("sleep")}${view.sleeping ? `<span>${esc(t("sleep"))}</span>` : ""}
      </button>`;
  }

  /**
   * Panneau réduit (option `compact`) : icône pour allumer ou éteindre, valeur
   * qui ouvre la fiche et, en contrôle manuel, une main pour rendre la main.
   */
  private _renderChip(pane: Pane, t: ReturnType<typeof translator>): string {
    const value = pane.value;
    const setpoint = pane.setpoint ? this._renderSetpoint(pane.setpoint, t) : "";
    const manual = pane.auto === "manual" && pane.autoEntity
      ? `<button class="chip-manual" data-action="auto" data-kind="${pane.kind}" title="${esc(`${pane.hint}. ${t("tap_resume")}`)}"
          aria-label="${esc(`${pane.title} : ${t("pill_manual")}. ${t("tap_resume")}`)}">${svg("hand")}</button>`
      : "";
    const style = `--level:${pane.level ?? (pane.on ? 100 : 0)};${pane.spin ? `--spin:${pane.spin.toFixed(2)}s;` : ""}`;
    return `
      <section class="pane chip pane-${pane.kind} ${pane.on ? "on" : ""}" ${pane.mode ? `data-mode="${esc(pane.mode)}"` : ""} style="${style}">
        <button class="pane-icon" data-action="toggle" data-kind="${pane.kind}"
          aria-pressed="${pane.on}" title="${esc(t("toggle"))}" aria-label="${esc(`${pane.title} : ${t("toggle")}`)}">${svg(paneIcon(pane))}</button>
        <button class="pane-value" data-action="more-info" data-entity="${esc(pane.entities[0])}"
          title="${esc(pane.hint)}" aria-label="${esc(`${pane.title} : ${value}`)}">
          <span class="value">${esc(value)}</span>
        </button>
        ${setpoint}
        ${manual}
      </section>`;
  }

  /** Consigne de la clim : − / +, envoyée après une pause (voir _setpoint). */
  private _renderSetpoint(sp: Setpoint, t: ReturnType<typeof translator>): string {
    const language = languageOf(this._hass!);
    return `<div class="stepper setpoint" role="group" aria-label="${esc(t("setpoint"))}">
        <button data-action="setpoint" data-dir="-1" ${sp.value <= sp.min ? "disabled" : ""}
          title="${esc(t("setpoint_down"))}" aria-label="${esc(t("setpoint_down"))}">${svg("minus")}</button>
        <div class="stepper-value ${this._pending.climate !== undefined ? "pending" : ""}">
          <span>${esc(formatValue(sp.value, sp.step, language))}&nbsp;°C</span>
        </div>
        <button data-action="setpoint" data-dir="1" ${sp.value >= sp.max ? "disabled" : ""}
          title="${esc(t("setpoint_up"))}" aria-label="${esc(t("setpoint_up"))}">${svg("plus")}</button>
      </div>`;
  }

  private _renderPane(pane: Pane, t: ReturnType<typeof translator>): string {
    const icon = paneIcon(pane);
    const pillLabel =
      pane.auto === "auto" ? t("pill_auto") : pane.auto === "manual" ? t("pill_manual") : t("pill_paused");
    const pillTitle =
      pane.auto === "manual" ? t("tap_resume") : pane.auto === "paused" ? t("tap_enable") : t("tap_pause");
    const pillIcon: IconName = pane.auto === "auto" ? "auto" : pane.auto === "manual" ? "hand" : "pause";
    const pill = pane.autoEntity
      ? `<button class="pill pill-${pane.auto}" data-action="auto" data-kind="${pane.kind}" title="${esc(pillTitle)}"
          aria-label="${esc(`${pane.title} : ${pillLabel}. ${pillTitle}`)}">${svg(pillIcon)}${esc(pillLabel)}</button>`
      : "";
    const level = pane.level ?? (pane.on ? 100 : 0);
    const slider = pane.setpoint
      ? this._renderSetpoint(pane.setpoint, t)
      : pane.level !== null
        ? `<div class="slider ${pane.level === 0 ? "zero" : ""}" role="slider" tabindex="0"
              aria-label="${esc(pane.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pane.level}" aria-valuetext="${pane.level} %"
              data-kind="${pane.kind}" style="--value:${pane.level}">
              <div class="slider-fill"></div><div class="slider-thumb"></div>
            </div>`
        : "";
    const style = `--level:${level};${pane.spin ? `--spin:${pane.spin.toFixed(2)}s;` : ""}`;
    return `
      <section class="pane pane-${pane.kind} ${pane.on ? "on" : ""}" ${pane.mode ? `data-mode="${esc(pane.mode)}"` : ""} style="${style}">
        <div class="pane-top">
          <button class="pane-icon" data-action="toggle" data-kind="${pane.kind}"
            aria-pressed="${pane.on}" title="${esc(t("toggle"))}" aria-label="${esc(`${pane.title} : ${t("toggle")}`)}">${svg(icon)}</button>
          ${pill}
        </div>
        <button class="pane-value" data-action="more-info" data-entity="${esc(pane.entities[0])}">
          <span class="pane-title">${esc(pane.title)}${pane.detail ? ` · ${esc(pane.detail)}` : ""}</span>
          <span class="value">${esc(pane.value)}</span>
        </button>
        ${slider}
        <div class="hint">${esc(pane.hint)}</div>
      </section>`;
  }

  private _renderSettings(view: RoomView, tabs: SettingTab[]): string {
    const hass = this._hass!;
    const language = languageOf(hass);
    const t = translator(language);
    const current = tabs.find((tab) => tab.id === this._tab) ?? tabs[0];
    this._tab = current.id;

    const nav = `<div class="tabs" role="tablist">${tabs
      .map(
        (tab) =>
          `<button class="tab" role="tab" id="tab-${tab.id}" data-action="tab" data-tab="${tab.id}"
            aria-selected="${tab.id === current.id}" aria-controls="tabpanel" tabindex="${tab.id === current.id ? 0 : -1}"
            title="${esc(tab.label)}" aria-label="${esc(tab.label)}">${svg(tab.icon)}<span>${esc(tab.label)}</span></button>`,
      )
      .join("")}</div>`;
    const rows = current.rows.map((row) => this._renderRow(row, language, t)).join("");

    return `
      <div class="card tone-calm">
        <header class="head">
          <button class="icon-btn" data-action="close" title="${esc(t("back"))}" aria-label="${esc(t("back"))}">${svg("back")}</button>
          <div class="name">${esc(t("settings"))}<span class="subtitle">${esc(view.name)}</span></div>
        </header>
        ${nav}
        <div class="rows" role="tabpanel" id="tabpanel" aria-labelledby="tab-${current.id}">${rows}</div>
      </div>`;
  }

  private _renderRow(row: SettingRow, language: string, t: ReturnType<typeof translator>): string {
    const state = this._hass!.states[row.entity];
    const help = (state && row.optionHelp?.[state.state]) ?? row.help;
    const text = `<div class="row-text"><div class="row-label">${esc(row.label)}</div>${
      help ? `<div class="row-help">${esc(help)}</div>` : ""
    }</div>`;
    if (!state || state.state === "unavailable") {
      return `<div class="row">${text}<span class="hint">—</span></div>`;
    }

    if (row.kind === "switch") {
      const on = state.state === "on";
      return `<div class="row">${text}<button class="switch" role="switch" aria-checked="${on}"
        data-action="switch" data-entity="${esc(row.entity)}" aria-label="${esc(row.label)}"></button></div>`;
    }

    if (row.kind === "time") {
      const value = state.state.slice(0, 5);
      return `<div class="row">${text}<input class="time-input" type="time" value="${esc(value)}"
        data-action="time" data-entity="${esc(row.entity)}" aria-label="${esc(row.label)}"></div>`;
    }

    if (row.kind === "select") {
      const options: string[] = state.attributes.options ?? [];
      const buttons = options
        .map((option) => {
          const label = row.options?.[option] ?? option;
          return `<button data-action="select" data-entity="${esc(row.entity)}" data-option="${esc(option)}"
            aria-pressed="${state.state === option}">${esc(label)}</button>`;
        })
        .join("");
      return `<div class="row stacked">${text}<div class="segmented" role="group" aria-label="${esc(row.label)}">${buttons}</div></div>`;
    }

    // Réglage numérique
    const a = state.attributes;
    const step = Number(a.step ?? 1);
    const min = Number(a.min ?? 0);
    const max = Number(a.max ?? 100);
    const pending = this._numbers.get(row.entity);
    const value = pending ?? Number(state.state);
    const unit: string | undefined = a.unit_of_measurement;
    // Durée lisible en gros, valeur brute en infobulle
    const duration = formatDuration(value, unit, t);
    const raw = `${formatValue(value, step, language)}${unit ? ` ${unit}` : ""}`;
    return `<div class="row">${text}
      <div class="stepper" role="group" aria-label="${esc(row.label)}">
        <button data-action="step" data-dir="-1" data-entity="${esc(row.entity)}" ${value <= min ? "disabled" : ""}
          aria-label="${esc(t("step_down", { name: row.label }))}">${svg("minus")}</button>
        <button class="stepper-value ${pending !== undefined ? "pending" : ""}" data-action="more-info" data-entity="${esc(row.entity)}"
          ${duration ? `title="${esc(raw)}"` : ""} aria-label="${esc(`${row.label} : ${duration ?? raw}`)}">
          <span>${esc(duration ?? raw).replace(/ /g, "&nbsp;")}</span>
        </button>
        <button data-action="step" data-dir="1" data-entity="${esc(row.entity)}" ${value >= max ? "disabled" : ""}
          aria-label="${esc(t("step_up", { name: row.label }))}">${svg("plus")}</button>
      </div></div>`;
  }

  // --- Comptes à rebours ------------------------------------------------------

  private _startTick(): void {
    if (this._tick !== undefined) return;
    this._tick = window.setInterval(() => {
      if (!this._hass || !this._config) return;
      this._view = buildView(this._hass, this._config, new Date(), this._pending);
      // Les réglages n'affichent aucun compte à rebours
      if (this._dragging || this._settingsOpen) return;
      if (!this._patch(this._view)) this._draw();
    }, 1000);
  }

  /**
   * Met à jour les comptes à rebours sans redessiner la carte : l'hélice ne
   * repart pas de zéro et le focus reste en place. Faux s'il faut redessiner.
   */
  private _patch(view: RoomView): boolean {
    if (this._drawnKey === undefined || tickKey(view) !== this._drawnKey) return false;
    const text = this._root.querySelector(".now-text");
    const notes = this._root.querySelectorAll(".notes li.note");
    const shown = this._shownNotes(view);
    if (!text || notes.length !== shown.length) return false;
    if (text.textContent !== view.now.text) text.textContent = view.now.text;
    shown.forEach((note, index) => {
      if (notes[index].textContent !== note) notes[index].textContent = note;
    });
    return true;
  }

  private _stopTick(): void {
    if (this._tick !== undefined) {
      window.clearInterval(this._tick);
      this._tick = undefined;
    }
  }

  // --- Gestes -----------------------------------------------------------------

  /** Appelle un service ; vrai s'il a réussi, sinon l'erreur est affichée. */
  private async _call(domain: string, service: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      await this._hass!.callService(domain, service, data);
      return true;
    } catch (err) {
      const t = translator(languageOf(this._hass!));
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
      this._notify(t("error", { e: message }));
      return false;
    }
  }

  /** Message en bas de l'écran de Home Assistant, avec un bouton facultatif. */
  private _notify(message: string, action?: { text: string; action: () => void }): void {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        detail: action ? { message, action, duration: 8000 } : { message },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Met l'automatisme d'un groupe en pause. Son panneau disparaît aussitôt :
   * un message permet d'annuler une pastille touchée par erreur.
   */
  private async _pause(pane: Pane): Promise<void> {
    const entityId = pane.autoEntity!;
    if (!(await this._call("switch", "turn_off", { entity_id: entityId }))) return;
    const t = translator(languageOf(this._hass!));
    const message = t(pane.kind === "lights" ? "note_lights_paused" : pane.kind === "fans" ? "note_fans_paused" : "note_climate_paused");
    this._notify(message, { text: t("undo"), action: () => this._call("switch", "turn_on", { entity_id: entityId }) });
  }

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  private _pane(kind: string | undefined): Pane | undefined {
    return this._view?.panes.find((pane) => pane.kind === kind);
  }

  private _onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target || (target as HTMLButtonElement).disabled || !this._view) return;
    const { action, kind, entity } = target.dataset;
    const room = this._view.entities;

    switch (action) {
      case "settings":
        this._settingsOpen = true;
        this._draw();
        break;
      case "close":
        this._settingsOpen = false;
        this._numbers.clear();
        this._draw();
        break;
      case "notes":
        this._notesOpen = !this._notesOpen;
        this._draw();
        break;
      case "tab":
        this._tab = target.dataset.tab as SettingTab["id"];
        this._draw();
        break;
      case "more-info":
        if (entity) this._moreInfo(entity);
        break;
      case "period":
        if (room.forced_night) {
          this._call("switch", this._view.forcedNight ? "turn_off" : "turn_on", { entity_id: room.forced_night });
        }
        break;
      case "resume":
        if (room.resume) this._call("button", "press", { entity_id: room.resume });
        break;
      case "sleep":
      case "wake":
        if (room.sleeping) {
          const asleep = this._hass!.states[room.sleeping]?.state === "on";
          this._call("switch", action === "wake" || asleep ? "turn_off" : "turn_on", { entity_id: room.sleeping });
        }
        break;
      case "enable": {
        const ids = [room.auto_lights, room.auto_fans, room.auto_climate].filter(
          (id): id is string => !!id && this._hass!.states[id]?.state === "off",
        );
        if (ids.length) this._call("switch", "turn_on", { entity_id: ids });
        break;
      }
      case "auto": {
        const pane = this._pane(kind);
        if (!pane?.autoEntity) break;
        if (pane.auto === "manual" && room.resume) this._call("button", "press", { entity_id: room.resume });
        else if (pane.auto === "paused") this._call("switch", "turn_on", { entity_id: pane.autoEntity });
        else this._pause(pane);
        break;
      }
      case "toggle": {
        const pane = this._pane(kind);
        if (!pane) break;
        this._call("homeassistant", pane.on ? "turn_off" : "turn_on", { entity_id: pane.entities });
        break;
      }
      case "switch":
        if (entity) this._call("switch", "toggle", { entity_id: entity });
        break;
      case "select":
        if (entity) this._call("select", "select_option", { entity_id: entity, option: target.dataset.option });
        break;
      case "step":
        if (entity) this._step(entity, Number(target.dataset.dir));
        break;
      case "setpoint":
        this._setpoint(Number(target.dataset.dir));
        break;
    }
  }

  private _onChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.dataset.action !== "time" || !target.dataset.entity || !target.value) return;
    this._call("time", "set_value", { entity_id: target.dataset.entity, time: `${target.value}:00` });
    target.blur();
  }

  /** Réglage numérique : valeur affichée tout de suite, envoyée après une pause. */
  private _step(entityId: string, direction: number): void {
    const state = this._hass!.states[entityId];
    if (!state) return;
    const a = state.attributes;
    const step = Number(a.step ?? 1);
    const min = Number(a.min ?? 0);
    const max = Number(a.max ?? 100);
    const current = this._numbers.get(entityId) ?? Number(state.state);
    const unit = a.unit_of_measurement;
    const increment =
      unit === "s" || unit === "min" ? durationStep(current, step, min, max, unit) : smartStep(current, step, min, max);
    // Arrondi au multiple de l'incrément, pour rester sur des valeurs rondes
    let next = direction > 0
      ? Math.floor(current / increment + 1e-9) * increment + increment
      : Math.ceil(current / increment - 1e-9) * increment - increment;
    next = Math.min(max, Math.max(min, Number(next.toFixed(6))));
    this._numbers.set(entityId, next);
    this._draw();

    window.clearTimeout(this._numberTimers.get(entityId));
    this._numberTimers.set(
      entityId,
      window.setTimeout(async () => {
        const value = this._numbers.get(entityId);
        if (value === undefined) return;
        await this._call("number", "set_value", { entity_id: entityId, value });
        // Laisse le temps à Home Assistant de renvoyer le nouvel état
        window.setTimeout(() => {
          if (this._numbers.get(entityId) === value) {
            this._numbers.delete(entityId);
            this._signature = [];
            this._render();
          }
        }, 1500);
      }, 700),
    );
  }

  /** Consigne de la clim : affichée tout de suite, envoyée après une pause. */
  private _setpoint(direction: number): void {
    const pane = this._pane("climate");
    const sp = pane?.setpoint;
    if (!pane || !sp) return;
    const next = Math.min(sp.max, Math.max(sp.min, Number((sp.value + direction * sp.step).toFixed(2))));
    this._pending.climate = next;
    this._signature = [];
    this._render();

    window.clearTimeout(this._setpointTimer);
    window.clearTimeout(this._pendingTimers.climate);
    this._setpointTimer = window.setTimeout(async () => {
      // Seules les clims en marche reçoivent la consigne
      const ids = pane.entities.filter((id) => {
        const state = this._hass!.states[id]?.state;
        return state !== undefined && !["off", "unavailable", "unknown"].includes(state);
      });
      if (ids.length) await this._call("climate", "set_temperature", { entity_id: ids, temperature: next });
      this._pendingTimers.climate = window.setTimeout(() => {
        delete this._pending.climate;
        this._signature = [];
        this._render();
      }, 2500);
    }, 700);
  }

  // --- Curseurs ---------------------------------------------------------------

  private _onPointerDown(event: PointerEvent): void {
    const slider = (event.target as HTMLElement).closest<HTMLElement>(".slider");
    if (!slider || event.button > 0) return;
    const kind = slider.dataset.kind as "lights" | "fans";
    event.preventDefault();
    slider.setPointerCapture(event.pointerId);
    this._dragging = { kind, slider };
    const move = (e: PointerEvent) => this._dragTo(e.clientX);
    const end = (e: PointerEvent) => {
      slider.removeEventListener("pointermove", move);
      slider.removeEventListener("pointerup", end);
      slider.removeEventListener("pointercancel", end);
      this._dragTo(e.clientX);
      this._commit(kind);
    };
    slider.addEventListener("pointermove", move);
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
    this._dragTo(event.clientX);
  }

  private _dragTo(clientX: number): void {
    if (!this._dragging) return;
    const { slider, kind } = this._dragging;
    const rect = slider.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const value = snap(ratio * 100, this._pane(kind)?.step ?? 1);
    this._pending[kind] = value;
    slider.style.setProperty("--value", String(value));
    slider.classList.toggle("zero", value === 0);
    slider.setAttribute("aria-valuenow", String(value));
    slider.setAttribute("aria-valuetext", `${value} %`);
    const valueLabel = slider.closest(".pane")?.querySelector(".value");
    if (valueLabel) valueLabel.textContent = `${value} %`;
  }

  private _onKeyDown(event: KeyboardEvent): void {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab) {
      this._onTabKey(event, tab);
      return;
    }
    const slider = (event.target as HTMLElement).closest<HTMLElement>(".slider");
    if (!slider) return;
    const kind = slider.dataset.kind as "lights" | "fans";
    const pane = this._pane(kind);
    const current = this._pending[kind] ?? pane?.level ?? 0;
    const step = pane?.step ?? 1;
    const small = Math.max(5, step);
    const big = Math.max(20, step);
    const delta = { ArrowRight: small, ArrowUp: small, ArrowLeft: -small, ArrowDown: -small, PageUp: big, PageDown: -big }[event.key];
    let value: number | undefined;
    if (delta !== undefined) value = snap(Math.min(100, Math.max(0, current + delta)), step);
    else if (event.key === "Home") value = 0;
    else if (event.key === "End") value = 100;
    if (value === undefined) return;
    event.preventDefault();
    this._pending[kind] = value;
    // La vue est recalculée avec la nouvelle valeur, puis redessinée
    this._commit(kind);
  }

  /** Onglets des réglages : flèches, Origine et Fin passent d'un onglet à l'autre. */
  private _onTabKey(event: KeyboardEvent, tab: HTMLElement): void {
    const tabs = [...this._root.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === "Home" ? tabs[0]
      : event.key === "End" ? tabs[tabs.length - 1]
      : undefined;
    if (!next) return;
    event.preventDefault();
    this._tab = next.dataset.tab as SettingTab["id"];
    this._draw();
    this._root.querySelector<HTMLElement>(`[role="tab"][data-tab="${this._tab}"]`)?.focus({ preventScroll: true });
  }

  /** Envoie la valeur du curseur et garde l'affichage le temps de la réponse. */
  private _commit(kind: "lights" | "fans"): void {
    const value = this._pending[kind];
    this._dragging = undefined;
    const pane = this._pane(kind);
    if (value === undefined || !pane) return;

    if (kind === "lights") {
      const lights = pane.entities.filter((e) => e.startsWith("light."));
      const others = pane.entities.filter((e) => !e.startsWith("light."));
      if (value === 0) this._call("homeassistant", "turn_off", { entity_id: pane.entities });
      else {
        if (lights.length) this._call("light", "turn_on", { entity_id: lights, brightness_pct: value });
        if (others.length) this._call("homeassistant", "turn_on", { entity_id: others });
      }
    } else {
      const fans = pane.entities.filter((e) => e.startsWith("fan."));
      const others = pane.entities.filter((e) => !e.startsWith("fan."));
      if (fans.length) this._call("fan", "set_percentage", { entity_id: fans, percentage: value });
      if (others.length) this._call("homeassistant", value === 0 ? "turn_off" : "turn_on", { entity_id: others });
    }

    window.clearTimeout(this._pendingTimers[kind]);
    this._pendingTimers[kind] = window.setTimeout(() => {
      delete this._pending[kind];
      this._signature = [];
      this._render();
    }, 2500);
    this._signature = [];
    this._render();
  }
}
