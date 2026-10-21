// Extrait les tracés des icônes utilisées depuis @mdi/js (Material Design Icons,
// licence Apache 2.0) vers src/icons.ts, pour une carte sans dépendance.
import { readFileSync, writeFileSync } from "node:fs";

const source = process.argv[2];
const names = {
  lightbulb: "mdiLightbulb",
  lightbulbOff: "mdiLightbulbOutline",
  fan: "mdiFan",
  fanOff: "mdiFanOff",
  thermometer: "mdiThermometer",
  water: "mdiWaterPercent",
  brightness: "mdiBrightness5",
  sun: "mdiWeatherSunny",
  moon: "mdiWeatherNight",
  cog: "mdiCogOutline",
  back: "mdiArrowLeft",
  hand: "mdiHandBackRightOutline",
  timer: "mdiTimerSandComplete",
  timerOutline: "mdiTimerOutline",
  account: "mdiAccount",
  home: "mdiHomeOutline",
  pause: "mdiPauseCircleOutline",
  play: "mdiPlayCircleOutline",
  auto: "mdiAlphaACircleOutline",
  tv: "mdiTelevisionPlay",
  alert: "mdiAlertCircleOutline",
  minus: "mdiMinus",
  plus: "mdiPlus",
  presence: "mdiMotionSensor",
  clock: "mdiClockOutline",
  climate: "mdiAirConditioner",
  climateOff: "mdiSnowflakeOff",
  sleep: "mdiSleep",
};
const js = readFileSync(source, "utf8");
const out = ["// Généré par scripts/icons.mjs — Material Design Icons (Apache 2.0).", "export const ICONS = {"];
for (const [key, mdi] of Object.entries(names)) {
  const m = js.match(new RegExp(`export var ${mdi} = "([^"]+)"`));
  if (!m) throw new Error(`Icône introuvable : ${mdi}`);
  out.push(`  ${key}: "${m[1]}",`);
}
out.push("} as const;", "", "export type IconName = keyof typeof ICONS;", "");
writeFileSync("src/icons.ts", out.join("\n"));
console.log(`${Object.keys(names).length} icônes écrites dans src/icons.ts`);
