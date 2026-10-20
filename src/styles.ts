// Styles de la carte. Tout passe par les variables du thème Home Assistant,
// avec des valeurs de repli, pour suivre les thèmes clair et sombre.

export const STYLES = `
:host {
  --lc-radius: var(--ha-card-border-radius, 12px);
  --lc-inner-radius: calc(var(--lc-radius) - 2px);
  --lc-text: var(--primary-text-color, #1c1c1e);
  --lc-muted: var(--secondary-text-color, #6b6b72);
  --lc-divider: var(--divider-color, rgba(127, 127, 127, 0.2));
  --lc-surface: color-mix(in srgb, var(--lc-text) 5%, transparent);
  --lc-light: var(--state-light-active-color, #f2a93b);
  --lc-fan: var(--state-fan-active-color, #23b5a8);
  --lc-cool: var(--state-climate-cool-color, #2b9af9);
  --lc-heat: var(--state-climate-heat-color, #ff8100);
  --lc-night: #7a7ff2;
  --lc-manual: var(--warning-color, #f08c2e);
  --lc-countdown: var(--primary-color, #3e8ef7);
  --lc-alert: var(--error-color, #e5484d);
  --lc-ok: var(--success-color, #3fa66a);
  display: block;
}

ha-card {
  overflow: hidden;
  height: 100%;
}

.card {
  position: relative;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--lc-text);
}

/* Halo discret qui reflète l'état de la pièce */
.card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 96px;
  background: radial-gradient(120% 100% at 0% 0%, var(--lc-tone, transparent) 0%, transparent 70%);
  opacity: 0.14;
  pointer-events: none;
  transition: opacity 0.4s ease;
}
.card > * { position: relative; }
.tone-occupied { --lc-tone: var(--lc-ok); }
.tone-manual { --lc-tone: var(--lc-manual); }
.tone-night { --lc-tone: var(--lc-night); }
.tone-countdown { --lc-tone: var(--lc-countdown); }
.tone-alert { --lc-tone: var(--lc-alert); }
.tone-calm { --lc-tone: transparent; }

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible, [tabindex]:focus-visible, input:focus-visible {
  outline: 2px solid var(--lc-countdown);
  outline-offset: 2px;
}
svg { width: 24px; height: 24px; fill: currentColor; display: block; flex: none; }

/* --- En-tête -------------------------------------------------------------- */

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle {
  margin-left: 8px;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--lc-muted);
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--lc-muted);
  transition: background 0.2s ease, color 0.2s ease;
}
.icon-btn:hover { background: var(--lc-surface); color: var(--lc-text); }
.icon-btn svg { width: 20px; height: 20px; }

.period {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px 0 9px;
  border-radius: 15px;
  background: var(--lc-surface);
  color: var(--lc-muted);
  font-size: 0.8rem;
  font-weight: 500;
  transition: background 0.2s ease, color 0.2s ease;
}
.period svg { width: 16px; height: 16px; }
.period.night {
  background: color-mix(in srgb, var(--lc-night) 16%, transparent);
  color: var(--lc-night);
}
.period.forced { box-shadow: inset 0 0 0 1.5px var(--lc-night); }
.period[disabled] { cursor: default; }

/* --- Phrase « maintenant » ------------------------------------------------ */

.now {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
}
.now-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex: none;
  color: var(--lc-tone-strong, var(--lc-muted));
  background: color-mix(in srgb, var(--lc-tone-strong, var(--lc-muted)) 14%, transparent);
}
.now-icon svg { width: 18px; height: 18px; }
.tone-occupied { --lc-tone-strong: var(--lc-ok); }
.tone-manual { --lc-tone-strong: var(--lc-manual); }
.tone-night { --lc-tone-strong: var(--lc-night); }
.tone-countdown { --lc-tone-strong: var(--lc-countdown); }
.tone-alert { --lc-tone-strong: var(--lc-alert); }
.now-text {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}
.now-action {
  flex: none;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--lc-tone-strong, var(--lc-countdown));
  background: color-mix(in srgb, var(--lc-tone-strong, var(--lc-countdown)) 14%, transparent);
  transition: filter 0.2s ease;
}
.now-action:hover { filter: brightness(1.1); }

.notes {
  list-style: none;
  margin: -6px 0 0;
  padding: 0 0 0 42px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8rem;
  color: var(--lc-muted);
  font-variant-numeric: tabular-nums;
}

/* --- Panneaux lumière / ventilateur --------------------------------------- */

.panes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 10px;
}
.pane {
  --lc-accent: var(--lc-light);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--lc-inner-radius);
  background: var(--lc-surface);
  transition: background 0.3s ease;
  min-width: 0;
}
.pane-fans { --lc-accent: var(--lc-fan); }
.pane-climate { --lc-accent: var(--lc-cool); }
.pane-climate[data-mode="heat"] { --lc-accent: var(--lc-heat); }
.pane-climate[data-mode="heat_cool"], .pane-climate[data-mode="auto"] { --lc-accent: var(--state-climate-auto-color, #008000); }
.pane-climate[data-mode="dry"] { --lc-accent: var(--state-climate-dry-color, #efbd07); }
.pane-climate[data-mode="fan_only"] { --lc-accent: var(--lc-fan); }

/* Consigne de la clim, à la place du curseur */
.pane .setpoint {
  justify-content: space-between;
  height: 28px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--lc-text) 9%, transparent);
}
.pane .setpoint button { width: 28px; height: 28px; background: transparent; }
.pane .setpoint button:hover { background: color-mix(in srgb, var(--lc-accent) 22%, transparent); }
.pane .setpoint .stepper-value { min-width: 0; }
.pane.on {
  background: color-mix(in srgb, var(--lc-accent) calc(7% + var(--level, 100) * 0.09%), transparent);
}
.pane-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pane-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  color: var(--lc-muted);
  background: color-mix(in srgb, var(--lc-text) 6%, transparent);
  transition: background 0.3s ease, color 0.3s ease, transform 0.15s ease;
}
.pane-icon:active { transform: scale(0.94); }
.pane.on .pane-icon {
  color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 22%, transparent);
}
.pane.on.pane-lights .pane-icon svg {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--lc-light) 60%, transparent));
}
.pane.on.pane-fans .pane-icon svg {
  animation: lc-spin var(--spin, 1.5s) linear infinite;
}
@keyframes lc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .pane.on.pane-fans .pane-icon svg { animation: none; }
}

.pill {
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: background 0.2s ease, color 0.2s ease;
}
.pill svg { width: 14px; height: 14px; }
.pill-auto { color: var(--lc-ok); background: color-mix(in srgb, var(--lc-ok) 14%, transparent); }
.pill-manual { color: var(--lc-manual); background: color-mix(in srgb, var(--lc-manual) 16%, transparent); }
.pill-paused { color: var(--lc-muted); background: color-mix(in srgb, var(--lc-text) 8%, transparent); }

.pane-value {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
  min-width: 0;
}
.pane-title { font-size: 0.8rem; color: var(--lc-muted); }
.value {
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.hint {
  font-size: 0.75rem;
  color: var(--lc-muted);
  line-height: 1.3;
}

.slider {
  position: relative;
  height: 28px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--lc-text) 9%, transparent);
  overflow: hidden;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.slider-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(var(--value) * 1%);
  min-width: 28px;
  border-radius: 14px;
  background: var(--lc-accent);
  opacity: 0.85;
}
.slider.zero .slider-fill { opacity: 0.25; }
.slider-thumb {
  position: absolute;
  top: 50%;
  left: max(calc(var(--value) * 1% - 14px), 0px);
  width: 28px;
  height: 28px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
}
.slider-thumb::after {
  content: "";
  width: 4px;
  height: 12px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.9);
}
.slider.zero .slider-thumb::after { background: var(--lc-muted); }

/* --- Ambiance ------------------------------------------------------------- */

.ambient {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-top: 2px;
  font-size: 0.85rem;
  color: var(--lc-muted);
  font-variant-numeric: tabular-nums;
}
.ambient-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ambient-item svg { width: 16px; height: 16px; opacity: 0.8; }
.ambient-item b { color: var(--lc-text); font-weight: 500; }

/* --- Réglages ------------------------------------------------------------- */

.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--lc-surface);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: max-content;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--lc-muted);
  transition: background 0.2s ease, color 0.2s ease;
}
.tab svg { width: 16px; height: 16px; }
/* Onglets compacts : libellé seulement pour l'onglet actif */
.tab[aria-selected="false"] { flex: 0 0 auto; }
.tab[aria-selected="false"] span { display: none; }
.tab[aria-selected="true"] { flex: 1; }
.tab[aria-selected="true"] {
  color: var(--lc-text);
  background: var(--ha-card-background, var(--card-background-color, #fff));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.rows {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--lc-divider);
}
.row:last-child { border-bottom: 0; }
.row.stacked { flex-direction: column; align-items: stretch; gap: 8px; }
.row.stacked .segmented button { flex: 1; }
.row-text { flex: 1; min-width: 0; }
.row-label { font-size: 0.9rem; }
.row-help { font-size: 0.75rem; color: var(--lc-muted); margin-top: 2px; line-height: 1.3; }

.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.stepper button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--lc-surface);
  color: var(--lc-text);
}
.stepper button:disabled { opacity: 0.35; cursor: default; }
.stepper button svg { width: 16px; height: 16px; }
.stepper-value {
  min-width: 64px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.stepper-value span { font-weight: 600; }
.stepper-value small { font-size: 0.7rem; color: var(--lc-muted); }
.stepper-value.pending span { color: var(--lc-countdown); }

.switch {
  position: relative;
  flex: none;
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--lc-text) 18%, transparent);
  transition: background 0.2s ease;
}
.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s ease;
}
.switch[aria-checked="true"] { background: var(--lc-ok); }
.switch[aria-checked="true"]::after { transform: translateX(18px); }

.time-input {
  flex: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--lc-text);
  background: var(--lc-surface);
  border: 0;
  border-radius: 8px;
  padding: 6px 8px;
  color-scheme: light dark;
}

.segmented {
  flex: none;
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 10px;
  background: var(--lc-surface);
}
.segmented button {
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 0.78rem;
  color: var(--lc-muted);
}
.segmented button[aria-pressed="true"] {
  color: var(--lc-text);
  background: var(--ha-card-background, var(--card-background-color, #fff));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.message {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--lc-muted);
  font-size: 0.9rem;
}

/* Cartes étroites : panneaux empilés, réglages sur deux lignes */
@container lumina (max-width: 300px) {
  .row { flex-wrap: wrap; }
  .tab span { display: none; }
}
/* Trois panneaux sur deux colonnes : le dernier prend toute la largeur */
@container lumina (min-width: 330px) and (max-width: 519px) {
  .pane:nth-child(3):last-child { grid-column: 1 / -1; }
}
.card { container: lumina / inline-size; }
`;
