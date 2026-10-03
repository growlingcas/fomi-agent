// Сценарии в приложении fomo (family.fomo.app) на облачном телефоне:
//   buy:    открыть токен → Buy → набрать сумму в $ → свайп → Add thesis → текст → Post
//   sell:   открыть токен → Sell → Max / 50% → свайп
// Каждое касание уходит на шину событий — сайт рисует его поверх живого экрана телефона.
//
// Предохранители:
//   • PHONE_DRY_RUN=1 (по умолчанию) — проходит весь путь, но НЕ делает финальный свайп
//   • перед свайпом проверяем, что на экране нужный тикер и нужная сумма
//   • если на экране слова «withdraw / seed phrase / private key / send to…» — немедленно назад и стоп:
//     в сценариях нет ни одного шага, ведущего к выводу или переводу денег
//   • сумма покупки ограничена MAX_POSITION_USD, продаём только позиции, которые открыл мозг
//   • файл brain/data/STOP или режим admin=off — никаких действий
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CFG } from "../config.js";
import { phone } from "./index.js";
import { emit } from "../bus.js";
import { getControl } from "../control.js";

const UI = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fomo-ui.json"), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stopFile = path.join(CFG.paths.data, "STOP");
let lastNodes = [];

function guard() {
  if (fs.existsSync(stopFile)) throw new Error("STOP file present — phone actions halted");
  if (getControl().mode === "off") throw new Error("agent is off (admin)");
}

async function screen() {
  const { nodes } = await phone.dumpUi().catch(() => ({ nodes: [] }));
  lastNodes = nodes;
  const all = nodes.map((n) => `${n.text} ${n.desc}`.toLowerCase()).join(" | ");
  const danger = (UI.dangerWords || []).find((w) => all.includes(w));
  if (danger) {
    emit("phone-step", { label: `unsafe screen ("${danger}") — backing out` });
    await phone.back(); await wait(800); await phone.back();
    throw new Error(`unsafe screen detected: "${danger}" — aborted`);
  }
  return { nodes, all };
}

async function point(sel, fresh = true) {
  const { w, h } = await phone.size();
  const nodes = fresh ? (await screen()).nodes : lastNodes;
  const hit = nodes.find((n) =>
    (sel.text && n.text === sel.text) || (sel.textAny && sel.textAny.includes(n.text)) ||
    (sel.textContains && n.text.toLowerCase().includes(sel.textContains.toLowerCase())) ||
    (sel.desc && n.desc === sel.desc));
  if (hit) return { x: hit.x, y: hit.y, w, h };
  return { x: sel.xy[0] * w, y: sel.xy[1] * h, w, h };
}

async function tapStep(step, label, fresh = true) {
  guard();
  const p = await point(UI.steps[step], fresh);
  emit("tap", { step, label: label || step, fx: p.x / p.w, fy: p.y / p.h });
  await phone.tap(p.x, p.y);
  await wait(CFG.phone.stepDelayMs);
}
async function tapXY(fx, fy, label) {
  guard();
  const { w, h } = await phone.size();
  emit("tap", { step: "key", label, fx, fy });
  await phone.tap(fx * w, fy * h);
  await wait(250);
}
async function swipe(pair, label) {
  guard();
  const { w, h } = await phone.size();
  emit("phone-step", { label });
  emit("tap", { step: "swipe", label, fx: pair[0][0], fy: pair[0][1] });
  await phone.swipe(pair[0][0] * w, pair[0][1] * h, pair[1][0] * w, pair[1][1] * h, 700);
  emit("tap", { step: "swipe", label, fx: pair[1][0], fy: pair[1][1] });
}
async function typeAmount(keypad, usd) {
  guard();
  const str = (Math.floor(usd * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  const keys = [...Array(7).fill("del"), ...str];
  const { w, h } = await phone.size();
  emit("phone-step", { label: `typing $${str}` });
  if (phone.sh) {
    // одна команда на весь набор — быстрее, чем по касанию на запрос
    await phone.sh(keys.map((k) => `input tap ${Math.round(keypad[k][0] * w)} ${Math.round(keypad[k][1] * h)}; sleep 0.15`).join("; "), true);
    for (const k of str) emit("tap", { step: "key", label: k, fx: keypad[k][0], fy: keypad[k][1] });
  } else {
    for (const k of keys) await tapXY(...keypad[k], k);
  }
  await wait(800);
  return str;
}
const has = (all, words) => words.every((w) => all.includes(String(w).toLowerCase()));

export async function openToken(address, symbol) {
  guard();
  emit("phone-step", { label: `opening $${symbol} on fomo` });
  try {
    await phone.openUrl(UI.deepLink.replace("{CA}", address), UI.package);
    await wait(4000);
    if (has((await screen()).all, [symbol])) return;
  } catch (e) { if (/unsafe|STOP|admin/.test(e.message)) throw e; }
  emit("phone-step", { label: "searching by contract" });
  await phone.openApp(UI.package);
  await wait(3000);
  await tapStep("navSearch", "search");
  await tapStep("searchInput", "search field");
  await phone.type(address);
  await wait(3000);
  await tapStep("firstResult", `$${symbol}`);
  await wait(3500);
  if (!has((await screen()).all, [symbol])) throw new Error(`token page for $${symbol} did not open`);
}

export async function buy({ address, symbol, usd, thesis }) {
  if (usd > CFG.bank.maxPos + 0.01) throw new Error(`$${usd} above MAX_POSITION_USD — refused`);
  if (usd < CFG.bank.minOrder) throw new Error(`$${usd} below fomo minimum — refused`);
  await openToken(address, symbol);
  await tapStep("buyButton", "buy");
  await wait(1200);
  const amt = await typeAmount(UI.keypadBuy, usd);
  const s1 = await screen();
  if (!has(s1.all, [symbol, `$${amt}`])) { await phone.back(); throw new Error(`buy screen doesn't show $${symbol} / $${amt} — aborted`); }
  if (CFG.phone.dryRun) {
    emit("phone-step", { label: `dry run: would slide to buy $${amt} of $${symbol}` });
    await phone.back();
    return { filled: false, dry: true };
  }
  await swipe(UI.slideBuy, `slide to buy $${amt}`);
  await wait(6000);
  const s2 = await screen();
  if (!has(s2.all, ["your position"])) emit("phone-step", { label: "no position visible yet — checking again" });
  emit("phone-step", { label: `bought $${amt} of $${symbol}` });
  let thesisPosted = false;
  if (thesis) thesisPosted = await postThesis(symbol, thesis);
  return { filled: true, thesisPosted };
}

export async function postThesis(symbol, text) {
  try {
    await tapStep("addThesis", "add thesis");
    await wait(1500);
    await tapStep("thesisInput", "thesis field");
    await phone.type(text.slice(0, 280));
    await wait(1500);
    await tapStep("postThesis", "post thesis");
    await wait(2500);
    emit("phone-step", { label: `thesis posted on $${symbol}` });
    return true;
  } catch (e) {
    emit("phone-step", { label: `thesis skipped: ${e.message}` });
    await phone.back().catch(() => {});
    return false;
  }
}

export async function sell({ address, symbol, pct }) {
  await openToken(address, symbol);
  await tapStep("sellButton", "sell");
  await wait(1200);
  await tapStep(pct >= 0.99 ? "sellMax" : "sell50", pct >= 0.99 ? "max" : "50%");
  const s1 = await screen();
  if (s1.all.includes("minimum")) { await phone.back(); return { filled: false, stuck: true }; }
  if (!has(s1.all, [symbol])) { await phone.back(); throw new Error(`sell screen doesn't show $${symbol} — aborted`); }
  if (CFG.phone.dryRun) {
    emit("phone-step", { label: `dry run: would slide to sell ${pct >= 0.99 ? "all" : "half"} of $${symbol}` });
    await phone.back();
    return { filled: false, dry: true };
  }
  await swipe(UI.slideSell, `slide to sell ${pct >= 0.99 ? "all" : "half"}`);
  await wait(6000);
  emit("phone-step", { label: `sold ${pct >= 0.99 ? "all" : "half"} of $${symbol}` });
  return { filled: true };
}

// Калибровка: сохранить скриншот и все элементы экрана
export async function snap() {
  await phone.connect();
  const dir = path.join(CFG.paths.data, "phone"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, phone.frameType === "image/jpeg" ? "screen.jpg" : "screen.png"), await phone.screenshot());
  const { xml, nodes } = await phone.dumpUi();
  fs.writeFileSync(path.join(dir, "ui.xml"), xml);
  const { w, h } = await phone.size();
  const list = nodes.filter((n) => n.text || n.desc).map((n) => `${(n.x / w).toFixed(3)},${(n.y / h).toFixed(3)}  text="${n.text}" desc="${n.desc}"${n.clickable ? " [tap]" : ""}`);
  fs.writeFileSync(path.join(dir, "elements.txt"), list.join("\n"));
  console.log(list.join("\n"));
  console.log(`\nsaved to ${dir}`);
}
