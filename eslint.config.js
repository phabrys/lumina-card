// Règles de lint : recommandations de typescript-eslint, avec vérification
// des types (promesses oubliées, any…). Prettier s'occupe de la mise en forme.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "build/", "node_modules/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", setTimeout: "readonly", URL: "readonly" },
    },
    // « _ » : valeur écartée exprès (déstructuration pour retirer une clé)
    rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^_$" }] },
  },
  {
    // DOM simulé par happy-dom dans les tests de la carte
    files: ["test/**/*.mjs"],
    languageOptions: {
      globals: { customElements: "readonly", document: "readonly", KeyboardEvent: "readonly" },
    },
  },
);
