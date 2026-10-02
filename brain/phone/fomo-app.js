// Сценарии в приложении fomo: найти токен по CA, купить, продать, запостить тезис.
// Каждое касание уходит на шину событий — сайт рисует его поверх живого экрана телефона.
// Предохранители:
//   PHONE_DRY_RUN=1 (по умолчанию) — проходит весь путь, но НЕ жмёт финальное «Confirm»;
//   перед подтверждением проверяет, что на экране правильный тикер, иначе отмена;
//   файл brain/data/STOP — мгновенная остановка любых действий.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CFG } from "../config.js";
import { phone } from "./index.js";
import { emit } from "../bus.js";

const UI = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fomo-ui.json"), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stopFile = path.join(CFG.paths.data, "STOP");

function guard() {
  if (fs.existsSync(stopFile)) throw new Error("STOP file present — phone actions halted");
}

async function find(step) {
  const sel = UI.steps[step];
  if (!sel) throw new Error(`no selector for ${step} in fomo-ui.json`);
  const { w, h } = await phone.size();
  const { nodes } = await phone.dumpUi().catch(() => ({ nodes: [] }));
  const hit = nodes.find((n) =>
    (sel.text && n.text === sel.text) || (sel.textContains && n.text.toLowerCase().includes(sel.textContains.toLowerCase())) ||
    (sel.desc && n.desc === sel.desc) || (sel.id && n.id.endsWith(sel.id)));
  if (hit) return { x: hit.x, y: hit.y, w, h, via: "ui" };
  if (sel.xy) return { x: sel.xy[0] * w, y: sel.xy[1] * h, w, h, via: "xy" };
  throw new Error(`can't find ${step} on screen`);
}

async function tapStep(step, label) {
  guard();
  const p = await find(step);
  emit("tap", { step, label: label || step, fx: p.x / p.w, fy: p.y / p.h });
  await phone.tap(p.x, p.y);
  await wait(CFG.phone.stepDelayMs);
}
async function typeText(text, label) {
  guard();
  emit("phone-step", { label: label || `typing ${text.slice(0, 24)}` });
  await phone.type(text);
  await wait(CFG.phone.stepDelayMs);
}
async function screenHas(words) {
  const { nodes } = await phone.dumpUi().catch(() => ({ nodes: [] }));
  if (!nodes.length) return true;                       // транспорт без UI-дерева — проверка невозможна
  const all = nodes.map((n) => (n.text + " " + n.desc).toLowerCase()).join(" ");
  return words.every((w) => all.includes(w.toLowerCase()));
}

export async function openToken(address, symbol) {
  guard();
  if (UI.deepLink && phone.openUrl) {
    emit("phone-step", { label: `opening $${symbol} on fomo` });
    try {
      await phone.openUrl(UI.deepLink.replace("{CA}", address), UI.package);
      await wait(3500);
      if (await screenHas([symbol])) return;          // открылась страница токена
    } catch { /* ниже — через поиск */ }
  }
  emit("phone-step", { label: `opening fomo` });
  await phone.openApp(UI.package);
  await wait(2500);
  await tapStep("openSearch", "search");
  await tapStep("searchInput", "search field");
  await typeText(address, `pasting CA of $${symbol}`);
  await wait(1500);
  await tapStep("firstResult", `$${symbol}`);
  await wait(1500);
}

export async function buy({ address, symbol, sizeSol }) {
  if (sizeSol > CFG.bank.maxPos) throw new Error(`size ${sizeSol} above MAX_POSITION_SOL — refused`);
  await openToken(address, symbol);
  await tapStep("buyButton", "buy");
  await tapStep("amountInput", "amount");
  await typeText(String(sizeSol), `${sizeSol} sol`);
  const must = (UI.checks.confirmScreenMustContain || []).map((w) => w.replace("{SYMBOL}", symbol));
  if (!(await screenHas(must))) { await phone.back(); throw new Error(`confirm screen doesn't show $${symbol} — aborted`); }
  if (CFG.phone.dryRun) { emit("phone-step", { label: `dry run: would confirm buy ${sizeSol} sol` }); await phone.back(); return { filled: false, dry: true }; }
  await tapStep("confirmBuy", `confirm buy ${sizeSol} sol`);
  await wait(3000);
  emit("phone-step", { label: `bought $${symbol}` });
  return { filled: true };
}

export async function sell({ address, symbol, pct }) {
  await openToken(address, symbol);
  await tapStep("sellButton", "sell");
  await tapStep(pct >= 0.99 ? "sell100" : "sell50", pct >= 0.99 ? "100%" : "50%");
  if (CFG.phone.dryRun) { emit("phone-step", { label: `dry run: would confirm sell ${Math.round(pct * 100)}%` }); await phone.back(); return { filled: false, dry: true }; }
  await tapStep("confirmSell", `confirm sell ${Math.round(pct * 100)}%`);
  await wait(3000);
  emit("phone-step", { label: `sold ${Math.round(pct * 100)}% $${symbol}` });
  return { filled: true };
}

export async function postThesis(symbol, text) {
  try {
    await tapStep("thesisInput", "write thesis");
    await typeText(text.slice(0, 200), "typing thesis");
    if (CFG.phone.dryRun) { emit("phone-step", { label: "dry run: thesis not posted" }); await phone.back(); return; }
    await tapStep("postThesis", "post thesis");
  } catch (e) { emit("phone-step", { label: `thesis skipped: ${e.message}` }); }
}

// Калибровка: сохранить скриншот и все элементы экрана, чтобы заполнить fomo-ui.json
export async function snap() {
  await phone.connect();
  const dir = path.join(CFG.paths.data, "phone"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, phone.frameType === "image/jpeg" ? "screen.jpg" : "screen.png"), await phone.screenshot());
  const { xml, nodes } = await phone.dumpUi();
  fs.writeFileSync(path.join(dir, "ui.xml"), xml);
  const { w, h } = await phone.size();
  const list = nodes.filter((n) => n.text || n.desc).map((n) => `${(n.x / w).toFixed(2)},${(n.y / h).toFixed(2)}  text="${n.text}" desc="${n.desc}" id="${n.id}"${n.clickable ? " [tap]" : ""}`);
  fs.writeFileSync(path.join(dir, "elements.txt"), list.join("\n"));
  console.log(list.join("\n"));
  console.log(`\nsaved to ${dir}`);
}
