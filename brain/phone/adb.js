// Управление Android-телефоном через ADB. Работает с облачным телефоном VMOS (если в кабинете
// включено ADB-подключение), с эмулятором или с обычным телефоном по USB/Wi-Fi.
// Нужен установленный adb (Android platform-tools).
import { execFile, spawn } from "node:child_process";
import { CFG } from "../config.js";
import { parseUi } from "./ui-parse.js";

const run = (args, opts = {}) => new Promise((res, rej) => {
  execFile("adb", CFG.phone.serial ? ["-s", CFG.phone.serial, ...args] : args, { maxBuffer: 32 << 20, encoding: opts.binary ? "buffer" : "utf8", timeout: 20000 },
    (err, out, errOut) => (err ? rej(new Error(`adb ${args.join(" ")}: ${errOut || err.message}`)) : res(out)));
});

export async function connect() {
  if (CFG.phone.serial && CFG.phone.serial.includes(":")) await run(["connect", CFG.phone.serial]).catch(() => {});
  const devices = await new Promise((res) => execFile("adb", ["devices"], (e, out) => res(out || "")));
  if (!devices.includes(CFG.phone.serial || "\tdevice")) throw new Error("phone not connected — check PHONE_SERIAL and adb");
  return size();
}

let _size = null;
export async function size() {
  if (_size) return _size;
  const out = await run(["shell", "wm", "size"]);
  const m = out.match(/(\d+)x(\d+)/g);
  const [w, h] = m[m.length - 1].split("x").map(Number);
  return (_size = { w, h });
}

export async function screenshot() {
  return new Promise((res, rej) => {
    const args = CFG.phone.serial ? ["-s", CFG.phone.serial, "exec-out", "screencap", "-p"] : ["exec-out", "screencap", "-p"];
    const p = spawn("adb", args); const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("close", (code) => (code === 0 ? res(Buffer.concat(chunks)) : rej(new Error("screencap failed"))));
    setTimeout(() => p.kill(), 15000);
  });
}

export const tap = (x, y) => run(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
export const swipe = (x1, y1, x2, y2, ms = 300) => run(["shell", "input", "swipe", ...[x1, y1, x2, y2].map((v) => String(Math.round(v))), String(ms)]);
export const key = (code) => run(["shell", "input", "keyevent", String(code)]);
export const back = () => key(4);
// adb input text не любит пробелы и спецсимволы — экранируем
export const type = (text) => run(["shell", "input", "text", text.replace(/[^\w.,:$%+\-@#/ ]/g, "").replace(/ /g, "%s").replace(/([$%#])/g, "\\$1")]);
export const openApp = (pkg) => run(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);

export const openUrl = (url, pkg) => run(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, ...(pkg ? [pkg] : [])]);

// Дерево интерфейса: какие кнопки и тексты сейчас на экране
export async function dumpUi() {
  await run(["shell", "uiautomator", "dump", "/sdcard/fomi_ui.xml"]);
  const xml = await run(["shell", "cat", "/sdcard/fomi_ui.xml"]);
  return { xml, nodes: parseUi(xml) };
}
