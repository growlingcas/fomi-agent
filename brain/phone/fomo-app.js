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
import { look, readPortfolio } from "./vision.js";

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
  if (danger) await bail(`unsafe screen detected: "${danger}"`);
  return { nodes, all, readable: nodes.some((n) => n.text) };
}
async function bail(why) {
  emit("phone-step", { label: `${why} — backing out` });
  await phone.back().catch(() => {}); await wait(800);
  await phone.openApp(UI.package).catch(() => {});          // назад в fomo, а не в Play Store
  throw new Error(`${why} — aborted`);
}

// Проверка экрана: сначала по тексту интерфейса, если Android его не отдал — по картинке через модель с «глазами».
async function verify({ ticker, amount, kind }) {
  const s = await screen();
  if (s.readable) {
    const ok = s.all.includes(String(ticker).toLowerCase()) && (!amount || s.all.includes(`$${amount}`));
    if (ok) return { ok, how: "ui" };
    // Android отдал мало текста (часть экрана — картинка/график) — смотрим глазами
  }
  const jpg = await phone.screenshot().catch(() => null);
  if (!jpg) return { ok: false, how: "no screen" };
  const v = await look(jpg, `Expected: ${kind} for ticker ${ticker}${amount ? `, amount $${amount}` : ""}. Is that what the screen shows?`);
  if (!v) return { ok: false, how: "vision unavailable" };
  if (v.danger) await bail("unsafe screen detected by vision");
  const tick = String(v.ticker || "").replace(/^\$/, "").toLowerCase() === String(ticker).toLowerCase();
  const amt = !amount || String(v.amount || "").replace(/[$\s]/g, "") === String(amount);
  return { ok: !!v.ok && tick && amt, how: "vision", saw: v };
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
    await wait(4500);
    if ((await verify({ ticker: symbol, kind: "token page" })).ok) return;
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
  const v = await verify({ ticker: symbol, kind: "token page" });
  if (!v.ok) throw new Error(`token page for $${symbol} did not open (${v.how}${v.saw ? ": saw " + JSON.stringify(v.saw) : ""})`);
}

export async function buy({ address, symbol, usd, thesis }) {
  if (usd > CFG.bank.maxPos + 0.01) throw new Error(`$${usd} above MAX_POSITION_USD — refused`);
  if (usd < CFG.bank.minOrder) throw new Error(`$${usd} below fomo minimum — refused`);
  await openToken(address, symbol);
  await tapStep("buyButton", "buy");
  await wait(1200);
  const amt = await typeAmount(UI.keypadBuy, usd);
  const v1 = await verify({ ticker: symbol, amount: amt, kind: "buy screen" });
  if (!v1.ok) { await phone.back(); throw new Error(`buy screen check failed for $${symbol} / $${amt} (${v1.how}${v1.saw ? ": saw " + JSON.stringify(v1.saw) : ""}) — aborted`); }
  if (CFG.phone.dryRun) {
    emit("phone-step", { label: `dry run: would slide to buy $${amt} of $${symbol}` });
    await phone.back();
    return { filled: false, dry: true };
  }
  await swipe(UI.slideBuy, `slide to buy $${amt}`);
  await wait(6500);
  // подтверждение: после покупки на странице токена должна появиться «Your position»
  let confirmed = false;
  for (let attempt = 0; attempt < 2 && !confirmed; attempt++) {
    if (attempt) await wait(6000);
    const after = await screen().catch(() => ({ all: "" }));
    confirmed = /your position|update thesis|add thesis|bought|order (filled|complete)/.test(after.all);
    if (!confirmed) {
      const jpg = await phone.screenshot().catch(() => null);
      const v = jpg && await look(jpg, `A buy of ${symbol} was just submitted. ok=true if the screen shows a "Your position" block, an "Add thesis" link, or a purchase success message for ${symbol}.`);
      confirmed = !!v?.ok;
    }
  }
  if (!confirmed) {
    emit("phone-step", { label: `can't confirm the $${symbol} buy — check fomo` });
    return { filled: false, unconfirmed: true };
  }

  emit("phone-step", { label: `bought $${amt} of $${symbol}` });
  const th = thesis ? await postThesis(symbol, thesis) : { ok: false, error: "no thesis" };
  return { filled: true, thesisPosted: th.ok, thesisError: th.error };
}

// Тезис: страница токена → «Add thesis» → поле → текст → «Post». Каждый шаг проверяется,
// при неудаче возвращаем причину — мозг попробует ещё раз на следующем тике.
export async function postThesis(symbol, text) {
  try {
    guard();
    await wait(2500);                                    // после покупки блок позиции появляется не сразу
    await tapStep("addThesis", "add thesis");
    await wait(2500);
    const ed = await screen();
    if (!ed.all.includes("add a thesis") && !ed.all.includes("position")) {
      const jpg = await phone.screenshot().catch(() => null);
      const v = jpg && await look(jpg, `Expected: the "add a thesis" editor for ${symbol} with a text field and a Post button.`);
      if (!v?.ok || v.screen !== "thesis") throw new Error("thesis editor did not open");
    }
    await tapStep("thesisInput", "thesis field", false);
    await wait(800);
    await phone.type(text.slice(0, 280));
    await wait(2000);
    await tapStep("postThesis", "post thesis");
    await wait(3500);
    const done = await screen();
    let ok = done.all.includes("thesis added") || done.all.includes("update thesis") || done.all.includes(text.slice(0, 20).toLowerCase());
    if (!ok) {
      const jpg = await phone.screenshot().catch(() => null);
      const v = jpg && await look(jpg, `Expected: token page for ${symbol} after posting a thesis — a "Thesis added" toast, an "Update thesis" link, or the thesis text under the position. ok=true only if one is visible.`);
      ok = !!v?.ok;
    }
    if (!ok) throw new Error("thesis not visible after Post");
    emit("phone-step", { label: `thesis posted on $${symbol}` });
    return { ok: true };
  } catch (e) {
    emit("phone-step", { label: `thesis failed: ${e.message}` });
    await phone.back().catch(() => {});
    return { ok: false, error: e.message };
  }
}

export async function sell({ address, symbol, pct }) {
  await openToken(address, symbol);
  await tapStep("sellButton", "sell");
  await wait(1200);
  await tapStep(pct >= 0.99 ? "sellMax" : "sell50", pct >= 0.99 ? "max" : "50%");
  const s1 = await screen();
  if (s1.all.includes("minimum")) { await phone.back(); return { filled: false, stuck: true }; }
  const v1 = await verify({ ticker: symbol, kind: "sell screen" });
  if (!v1.ok) { await phone.back(); throw new Error(`sell screen check failed for $${symbol} (${v1.how}) — aborted`); }
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

// Сверка с fomo: вкладка профиля → «Total cash» и список позиций
export async function portfolio() {
  guard();
  emit("phone-step", { label: "checking my fomo balance" });
  await phone.openApp(UI.package);
  await wait(3000);
  await tapStep("navProfile", "profile");
  await wait(4000);
  const s = await screen();
  const jpg = await phone.screenshot().catch(() => null);
  const v = jpg ? await readPortfolio(jpg) : null;
  // кэш из текста интерфейса надёжнее, если Android его отдал
  const texts = s.nodes.map((n) => n.text).filter(Boolean);
  const i = texts.findIndex((t) => /total cash/i.test(t));
  const uiCash = i >= 0 ? Number((texts.slice(i + 1).find((t) => /^\$[\d,.]+$/.test(t)) || "").replace(/[$,]/g, "")) : NaN;
  await tapStep("navHome", "home").catch(() => {});
  if (!v?.ok && !Number.isFinite(uiCash)) return null;
  return {
    cash: Number.isFinite(uiCash) && uiCash > 0 ? uiCash : Number(v?.cash),
    total: Number(v?.total) || null,
    positions: (v?.positions || []).map((p) => ({ name: String(p.name || ""), ticker: String(p.ticker || "").replace(/^\$/, "").toUpperCase(),
      value: Number(p.value) || 0, pnlPct: Number(p.pnlPct) || 0 })),
  };
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
