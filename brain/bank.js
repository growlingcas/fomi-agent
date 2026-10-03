// Банк-менеджмент в долларах. Правила жёсткие — ни модель, ни кто-то снаружи их не обойдёт.
import { CFG } from "./config.js";
import { load, save } from "./store.js";

const today = () => new Date().toISOString().slice(0, 10);
export const priceOf = (t) => Number(t?.priceUsd) || 0;

function fresh() {
  return { unit: "usd", cash: CFG.bank.start, start: CFG.bank.start, positions: [], orders: [], entryTimes: [],
    realized: 0, day: { date: today(), pnl: 0 }, lossStreak: 0, pausedUntil: 0, halted: false, lastEntry: {} };
}

export function loadBank() {
  let b = load("bank", null);
  if (!b || b.unit !== "usd") {                       // старый банк в SOL — архивируем и начинаем в долларах
    if (b) save("bank_archive_sol", b);
    b = fresh();
  }
  b.entryTimes ||= [];
  if (b.day.date !== today()) b.day = { date: today(), pnl: 0 };
  return b;
}
export const saveBank = (b) => save("bank", b);

export const valueOf = (pos, price) => pos.tokens * pos.remaining * price;
export function equity(b, prices = new Map()) {
  return b.cash + b.positions.reduce((s, p) => s + valueOf(p, priceOf(prices.get(p.address)) || p.lastPrice || p.entryPrice) * (1 - CFG.bank.feePct), 0);
}
export function exposure(b) {
  const pending = (b.orders || []).filter((o) => o.side === "buy").reduce((s, o) => s + o.size, 0);
  return b.positions.reduce((s, p) => s + p.size * p.remaining, 0) + pending;
}
export const entriesLastHour = (b) => b.entryTimes.filter((t) => Date.now() - t < 3600e3).length;

// Можно ли сейчас входить? Причина отказа или null.
export function gate(b, eq) {
  const c = CFG.bank;
  if (b.halted) return "halted: bank below limit — run `npm run resume`";
  if (eq < c.haltEquity) { b.halted = true; return "halted: bank below limit"; }
  if (Date.now() < b.pausedUntil) return `cooldown after ${c.lossStreakPause} losses in a row`;
  if (b.day.pnl <= -c.dailyLossLimit) return "daily loss limit hit";
  if (b.positions.length + (b.orders || []).filter((o) => o.side === "buy").length >= c.maxOpen) return "max open positions";
  if (entriesLastHour(b) >= c.maxEntriesPerHour) return `max ${c.maxEntriesPerHour} entries per hour`;
  return null;
}

// Размер позиции в $ от уверенности. null = нельзя.
export function sizeFor(b, eq, conviction, address) {
  const c = CFG.bank;
  const last = b.lastEntry[address];
  if (last && Date.now() - last < c.reentryCooldownH * 3600e3) return null;
  if ((b.orders || []).some((o) => o.side === "buy" && o.address === address)) return null;
  const tradable = Math.max(0, eq - c.reserve);
  let size = tradable * c.basePct * (0.5 + Math.max(0, Math.min(1, conviction)));
  size = Math.max(size, c.minPos);
  size = Math.min(size, c.maxPos, tradable * c.maxExposurePct - exposure(b), b.cash - c.reserve);
  size = Math.floor(size);                       // целые доллары: на клавиатуре fomo одно нажатие, меньше шансов ошибиться
  if (size < c.minPos) return null;
  return size;
}

export function recordClose(b, pnl) {
  b.realized += pnl;
  b.day.pnl += pnl;
  b.lossStreak = pnl < 0 ? b.lossStreak + 1 : 0;
  if (b.lossStreak >= CFG.bank.lossStreakPause) {
    b.pausedUntil = Date.now() + CFG.bank.pauseMinutes * 60e3;
    b.lossStreak = 0;
  }
}

// Уровни выхода для позиции — то же самое показывается на сайте как план.
export function levels(pos) {
  const e = CFG.exits;
  return {
    sl: pos.entryPrice * (1 + (pos.tp1Done ? 0 : e.stopLoss)),
    tp1: pos.entryPrice * (1 + e.tp1),
    tp2: pos.entryPrice * (1 + e.tp2),
    trail: pos.tp1Done ? (pos.peak ?? pos.entryPrice) * (1 - e.trail) : null,
  };
}

// Какой выход сработал при цене price: {pct, reason} или null.
// fomo не даёт ордер меньше $2: частичную продажу, если кусок < $2, превращаем в полную.
export function exitCheck(pos, price) {
  const e = CFG.exits;
  const pnl = price / pos.entryPrice - 1;
  pos.peak = Math.max(pos.peak ?? pos.entryPrice, price);
  const hrs = (Date.now() - pos.openedAt) / 3600e3;
  let ex = null;
  if (pnl <= (pos.tp1Done ? 0 : e.stopLoss)) ex = { pct: 1, reason: pos.tp1Done ? "breakeven stop" : "stop loss" };
  else if (pnl >= e.tp2) ex = { pct: 1, reason: "tp2" };
  else if (!pos.tp1Done && pnl >= e.tp1) ex = { pct: e.tp1Sell, reason: "tp1" };
  else if (pos.tp1Done && price <= pos.peak * (1 - e.trail)) ex = { pct: 1, reason: "trailing stop" };
  else if (hrs >= e.timeStopH && pnl > e.timeBand[0] && pnl < e.timeBand[1]) ex = { pct: 1, reason: "time stop" };
  if (!ex) return null;
  const value = valueOf(pos, price);
  if (value < CFG.bank.minOrder) return { ...ex, stuck: true };                 // меньше минимума fomo — продать нельзя
  if (ex.pct < 1 && value * ex.pct < CFG.bank.minOrder + 0.1) ex.pct = 1;     // кусок слишком мал — продаём всё
  return ex;
}
