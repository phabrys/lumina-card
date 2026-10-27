// Éditeur visuel de la carte (Modifier le tableau de bord → carte Lumina).
// Utilise le formulaire natif de Home Assistant (ha-form) quand il est
// disponible, sinon une liste simple des pièces Lumina.

import { BaseElement, esc } from "./dom.js";
import type { StringKey, Translate } from "./i18n.js";
import { languageOf, luminaDevices, translator, type CardConfig, type Hass } from "./model.js";

export class LuminaCardEditor extends BaseElement {
  private _config: CardConfig = { type: "custom:lumina-card" };
  private _hass?: Hass;
  private _form?: HTMLElement & Record<string, unknown>;

  setConfig(config: CardConfig): void {
    this._config = { ...config };
    this._render();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this._render();
  }

  private _schema(t: Translate) {
    return [
      { name: "device", required: true, selector: { device: { filter: { integration: "lumina" } } } },
      { name: "name", selector: { text: {} } },
      { name: "compact", selector: { boolean: {} } },
      {
        name: "hide_panes",
        selector: {
          select: {
            multiple: true,
            options: (["lights", "fans", "climate"] as const).map((kind) => ({ value: kind, label: t(`tab_${kind}`) })),
          },
        },
      },
      { name: "hide_ambient", selector: { boolean: {} } },
      { name: "hide_settings", selector: { boolean: {} } },
    ];
  }

  private _render(): void {
    if (!this._hass) return;
    const t = translator(languageOf(this._hass));

    if (customElements.get("ha-form")) {
      if (!this._form) {
        this.innerHTML = "";
        this._form = document.createElement("ha-form") as HTMLElement & Record<string, unknown>;
        this._form.addEventListener("value-changed", (event) => {
          const value = (event as CustomEvent<{ value: CardConfig }>).detail.value;
          this._update({ ...this._config, ...value });
        });
        this.appendChild(this._form);
      }
      this._form.hass = this._hass;
      this._form.data = this._config;
      this._form.schema = this._schema(t);
      this._form.computeLabel = (field: { name: string }) => t(`e_${field.name}` as StringKey);
      return;
    }

    // Repli sans ha-form
    const hass = this._hass;
    const options = luminaDevices(hass)
      .map((id) => {
        const device = hass.devices?.[id];
        const area = device?.area_id ? hass.areas?.[device.area_id]?.name : undefined;
        const label = area ?? device?.name_by_user ?? device?.name ?? id;
        return `<option value="${esc(id)}" ${id === this._config.device ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("");
    this.innerHTML = `
      <label style="display:flex;flex-direction:column;gap:4px;font:inherit">
        ${esc(t("e_device"))}
        <select data-field="device"><option value=""></option>${options}</select>
      </label>`;
    this.querySelector("select")?.addEventListener("change", (event) => {
      this._update({ ...this._config, device: (event.target as HTMLSelectElement).value || undefined });
    });
  }

  private _update(config: CardConfig): void {
    // Champs vides retirés pour garder un YAML propre
    const clean = Object.fromEntries(
      Object.entries(config).filter(
        ([, value]) =>
          value !== undefined && value !== "" && value !== false && !(Array.isArray(value) && !value.length),
      ),
    ) as unknown as CardConfig;
    this._config = clean;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: clean }, bubbles: true, composed: true }));
  }
}
