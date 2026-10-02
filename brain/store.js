// Простое файловое хранилище: всё состояние мозга лежит в brain/data/*.json и коммитится в репо.
import fs from "node:fs";
import path from "node:path";
import { CFG } from "./config.js";

const file = (name) => path.join(CFG.paths.data, name + ".json");

export function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); }
  catch { return structuredClone(fallback); }
}
export function save(name, value) {
  fs.mkdirSync(CFG.paths.data, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}
