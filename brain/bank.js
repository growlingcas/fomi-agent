// Банк-менеджмент. Правила простые и жёсткие — мозг не может их обойти.
import { CFG } from "./config.js";
import { load, save } from "./store.js";

const today = () => new Date().toISOString().slice(0, 10);

export function loadBank() {
  const b = load("bank", {
    cash: CFG.bank.start, start: CFG.bank.start, positions: [], orders: [],
    realized: 0, day: { date: today(), pnl: 0 }, lossStreak: 0, pausedUntil: 0, halted: false, lastEntry: {},
  });
  if (b.day.date !== today()) b.day = { date: today(), pnl: 0 };
  return b;
}
export const saveBank = (b) => save("bank", b);

export function markValue(pos, price) {
  return pos.tokens * pos.remaining * price * (1 - CFG.bank.feePct);
}
export function equity(b, prices = new Map()) {
  return b.cash + b.positions.reduce((s, p) => s + markValue(p, prices.get(p.address)?.priceNative ?? p.lastPrice ?? p.entryPrice), 0);
}
export function exposure(b) {
  const pending = (b.orders || []).filter((o) => o.side === "buy").reduce((s, o) => s + o.sizeSol, 0);
  return b.positions.reduce((s, p) => s + p.sizeSol * p.remaining, 0) + pending;
}

// Можно ли сейчас вообще входить? Возвращает причину отказа или null.
export function gate(b, eq) {
  const c = CFG.bank;
  if (b.halted) return "halted: equity below limit — run `npm run resume`";
  if (eq < c.haltEquity) { b.halted = true; return "halted: equity below limit"; }
  if (Date.now() < b.pausedUntil) return `paused after ${c.lossStreakPause} losses in a row`;
  if (b.day.pnl <= -c.dailyLossLimit) return "daily loss limit hit";
  if (b.positions.length + (b.orders || []).filter((o) => o.side === "buy").length >= c.maxOpen) return "max open positions";
  return null;
}

// Размер позиции от уверенности. null = нельзя.
export function sizeFor(b, eq, conviction, address) {
  const c = CFG.bank;
  const last = b.lastEntry[address];
  if (last && Date.now() - last < c.reentryCooldownH * 3600e3) return null;
  if ((b.orders || []).some((o) => o.side === "buy" && o.address === address)) return null;
  const tradable = Math.max(0, eq - c.reserve);
  let size = tradable * c.basePct * (0.5 + Math.max(0, Math.min(1, conviction)));
  const pendingCash = (b.orders || []).filter((o) => o.side === "buy").reduce((s, o) => s + o.sizeSol, 0);
  size = Math.min(size, c.maxPos, tradable * c.maxExposurePct - exposure(b), b.cash - pendingCash - c.reserve);
  if (size < c.minPos) return null;
  return +size.toFixed(3);
}

export function recordClose(b, pnlSol) {
  b.realized += pnlSol;
  b.day.pnl += pnlSol;
  b.lossStreak = pnlSol < 0 ? b.lossStreak + 1 : 0;
  if (b.lossStreak >= CFG.bank.lossStreakPause) {
    b.pausedUntil = Date.now() + CFG.bank.pauseMinutes * 60e3;
    b.lossStreak = 0;
  }
}

// Какие выходы сработали для позиции при цене price. Возвращает {pct, reason} или null.
export function exitCheck(pos, price) {
  const e = CFG.exits;
  const pnl = price / pos.entryPrice - 1;
  pos.peak = Math.max(pos.peak ?? pos.entryPrice, price);
  const hrs = (Date.now() - pos.openedAt) / 3600e3;
  if (pnl <= (pos.tp1Done ? 0 : e.stopLoss)) return { pct: 1, reason: pos.tp1Done ? "breakeven stop" : "stop loss" };
  if (pnl >= e.tp2) return { pct: 1, reason: "tp2" };
  if (!pos.tp1Done && pnl >= e.tp1) return { pct: e.tp1Sell, reason: "tp1" };
  if (pos.tp1Done && price <= pos.peak * (1 - e.trail)) return { pct: 1, reason: "trailing stop" };
  if (hrs >= e.timeStopH && pnl > e.timeBand[0] && pnl < e.timeBand[1]) return { pct: 1, reason: "time stop" };
  return null;
}
