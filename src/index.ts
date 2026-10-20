// Point d'entrée : déclare les éléments et annonce la carte à Home Assistant.

import { LuminaCard } from "./card.js";
import { LuminaCardEditor } from "./editor.js";

declare const __VERSION__: string;

if (typeof customElements !== "undefined") {
  if (!customElements.get("lumina-card")) customElements.define("lumina-card", LuminaCard);
  if (!customElements.get("lumina-card-editor")) customElements.define("lumina-card-editor", LuminaCardEditor);

  const registry = ((window as unknown as { customCards?: unknown[] }).customCards ??= []);
  if (!registry.some((card) => (card as { type?: string }).type === "lumina-card")) {
    registry.push({
      type: "lumina-card",
      name: "Lumina",
      description: "Pilote une pièce gérée par Lumina : lumière, ventilateur, nuit et réglages.",
      preview: true,
      documentationURL: "https://github.com/phabrys/lumina-card",
    });
  }

  console.info(
    `%c LUMINA-CARD %c ${__VERSION__} `,
    "color:#fff;background:#f2a93b;font-weight:700;border-radius:3px 0 0 3px",
    "color:#f2a93b;background:#222;border-radius:0 3px 3px 0",
  );
}
