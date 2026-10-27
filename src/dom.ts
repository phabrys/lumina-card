// Outils communs à la carte et à son éditeur.

/**
 * Classe de base des éléments : HTMLElement dans le navigateur, une classe
 * vide ailleurs (le modèle est testé sous Node, sans DOM).
 */
export const BaseElement: typeof HTMLElement =
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ?? (class {} as typeof HTMLElement);

/** Échappe un texte pour l'insérer dans du HTML, en contenu comme en attribut. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
