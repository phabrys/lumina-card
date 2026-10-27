// Compile les sources TypeScript puis les assemble en un seul module,
// dist/lumina-card.js, sans dépendance : c'est le fichier que charge HACS.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

// 1. Compilation (tsc local si installé, sinon celui du système)
const localTsc = join(root, "node_modules", ".bin", "tsc");
execFileSync(existsSync(localTsc) ? localTsc : "tsc", ["-p", join(root, "tsconfig.json")], {
  stdio: "inherit",
});

// 2. Assemblage dans l'ordre des dépendances
const ORDER = ["icons", "i18n", "model", "styles", "dom", "card", "editor", "index"];
const IMPORT = /^import\s[\s\S]*?\sfrom\s+["']\.\/[^"']+["'];?[ \t]*$/gm;
const EXPORT_LIST = /^export\s*\{[^}]*\};?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(?=(?:const|let|var|function|async\s+function|class)\b)/gm;

const parts = ORDER.map((name) => {
  const code = readFileSync(join(root, "build", `${name}.js`), "utf8")
    .replace(IMPORT, "")
    .replace(EXPORT_LIST, "")
    .replace(EXPORT_DECL, "")
    .replace(/__VERSION__/g, JSON.stringify(version))
    .trim();
  return `// --- ${name}.ts ---\n${code}`;
});

const bundle = `/*! Lumina Card ${version} — https://github.com/phabrys/lumina-card — MIT
 * Icônes : Material Design Icons (Apache 2.0). Fichier généré, ne pas modifier :
 * les sources sont dans src/. */
${parts.join("\n\n")}
`;

for (const leftover of [/^\s*import\s.+from\s/m, /^\s*export\s/m]) {
  if (leftover.test(bundle)) throw new Error(`Assemblage incomplet : ${leftover}`);
}

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "lumina-card.js");
writeFileSync(out, bundle);
// Vérifie que le module est syntaxiquement valide (noms en double, etc.)
execFileSync(process.execPath, ["--check", out], { stdio: "inherit" });
console.log(`dist/lumina-card.js ${version} (${(bundle.length / 1024).toFixed(1)} Kio)`);
