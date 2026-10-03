// Облачный телефон VMOS через их OpenAPI (https://api.vmoscloud.com, подпись V2: SHA-256).
// Документация: https://cloud.vmoscloud.com/vmoscloud/doc/en/server/example.html
//
//   экран      → getLongGenerateUrl (ссылка на живое превью, обновляем по истечении)
//   нажатия    → asyncCmd: `input tap x y` / `input swipe` / `input keyevent`
//   текст      → inputText (печатает в поле, где сейчас фокус)
//   приложение → startApp / `am start -d <ссылка>`
//   интерфейс  → asyncCmd: uiautomator dump → результат через executeScriptInfo
//
// Ключи только в .env на сервере (VMOS_AK / VMOS_SK / VMOS_PAD_CODE). На сайт они не попадают никогда.
import crypto from "node:crypto";
import { CFG } from "../config.js";
import { parseUi } from "./ui-parse.js";

const BASE = "https://api.vmoscloud.com";
const P = "/vcpcloud/api/padApi";
const UNSIGNED_BODY = new Set([`${P}/asyncCmd`, `${P}/syncCmd`, `${P}/uploadFile`, `${P}/uploadFileV3`]);
const pad = () => CFG.phone.padCode;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function sign(sk, ts, path, bodyOrQuery) {
  return crypto.createHash("sha256").update(sk + ts + path + bodyOrQuery, "utf8").digest("hex");
}

export async function call(path, body) {
  if (!CFG.phone.vmosAk || !CFG.phone.vmosSk || !pad()) throw new Error("set VMOS_AK, VMOS_SK and VMOS_PAD_CODE in .env");
  const raw = body ? JSON.stringify(body) : "";
  const send = async (signBody) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "X-Access-Key": CFG.phone.vmosAk, "X-Timestamp": ts, "Content-Type": "application/json",
        "X-Sign": sign(CFG.phone.vmosSk, ts, path, signBody ? raw : "") },
      body: raw,
    });
    return r.json().catch(() => ({ code: r.status, msg: "bad json" }));
  };
  // в документации VMOS расходится, подписывается ли тело у командных методов — пробуем оба варианта
  let j = await send(!UNSIGNED_BODY.has(path));
  if (j.code === 2019) j = await send(UNSIGNED_BODY.has(path));
  if (j.code !== 200) throw new Error(`vmos ${path.replace(P, "")}: ${j.code} ${j.msg || ""}`);
  return Array.isArray(j.data) ? j.data[0] : j.data;
}

// ADB-команда внутри облачного телефона. wantOutput — дождаться и вернуть вывод.
export async function sh(cmd, wantOutput = false) {
  const d = await call(`${P}/asyncCmd`, { padCodes: [pad()], scriptContent: cmd });
  const taskId = d?.taskId;
  if (!taskId) return "";
  const deadline = Date.now() + (wantOutput ? 20000 : 8000);
  while (Date.now() < deadline) {
    await wait(600);
    try {
      const t = await call(`${P}/executeScriptInfo`, { taskIds: [taskId] });
      if (t?.taskStatus === 3) return t.taskResult || "";
      if (t?.taskStatus < 0) throw new Error(`cmd failed: ${t.errorMsg || t.taskStatus}`);
    } catch (e) {
      if (String(e.message).startsWith("cmd failed")) throw e;
      if (!wantOutput) { await wait(CFG.phone.stepDelayMs); return ""; }   // нет статуса — просто ждём
    }
  }
  return "";
}

let _size = null;
export async function size() {
  if (_size) return _size;
  try {
    const out = await sh("wm size", true);
    const m = out.match(/(\d+)x(\d+)(?!.*\d+x\d+)/s);
    if (m) return (_size = { w: +m[1], h: +m[2] });
  } catch { /* ниже — запасной вариант */ }
  return (_size = { w: CFG.phone.width, h: CFG.phone.height });
}

let preview = { url: null, exp: 0 };
async function previewUrl() {
  if (preview.url && Date.now() < preview.exp - 60e3) return preview.url;
  const d = await call(`${P}/getLongGenerateUrl`, { padCodes: [pad()], format: "jpg", quality: 70, width: "540" });
  if (!d?.url) throw new Error(`no preview url: ${d?.reason || "unknown"}`);
  preview = { url: d.url, exp: d.expireAt || Date.now() + 10 * 60e3 };
  return preview.url;
}

export async function connect() { await previewUrl(); return size(); }
export async function screenshot() {
  const url = await previewUrl();
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
  if (!r.ok) { preview.url = null; throw new Error("preview " + r.status); }
  return Buffer.from(await r.arrayBuffer());
}
export const frameType = "image/jpeg";

export const tap = (x, y) => sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
export const swipe = (x1, y1, x2, y2, ms = 300) => sh(`input swipe ${[x1, y1, x2, y2].map(Math.round).join(" ")} ${ms}`);
export const key = (code) => sh(`input keyevent ${code}`);
export const back = () => key(4);
export const type = (text) => call(`${P}/inputText`, { padCodes: [pad()], text });
export const openApp = (pkg) => call(`${P}/startApp`, { padCodes: [pad()], pkgName: pkg });
export const openUrl = (url, pkg) => sh(`am start -a android.intent.action.VIEW -d '${url.replace(/'/g, "")}' ${pkg || ""}`);
export async function dumpUi() {
  const xml = await sh("uiautomator dump /sdcard/fomi_ui.xml >/dev/null 2>&1; cat /sdcard/fomi_ui.xml", true);
  return { xml, nodes: parseUi(xml) };
}
